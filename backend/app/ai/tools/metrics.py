"""
The measures-by-dimensions tool — the one that answers most questions.

The panel catalogue (`structured.py`) offers ~17 fixed shapes, each a measure
already paired with a dimension. That works right up until someone asks for a
pairing nobody pre-baked, and then it fails in a way that looks like the model
being stupid: asked for "total minutes day by day", it could only reach minutes
through the `summary` panel, which reports one figure for a whole range — so
the only route to a per-day answer was one call per day, and an eleven-day
question exhausted the round budget before it produced anything.

This tool inverts that. Measures and dimensions are chosen independently, so
minutes-by-date, connect-rate-by-carrier, calls-by-account and
minutes-by-conference are all one call, and so is any other pairing — including
the ones nobody thought of when this was written.

It builds its own SQL rather than extending `app.cdr.service`: that module's
projected slice carries neither ACCOUNTID nor CALL_DATE, and the AI module is
meant to read from `app.cdr` without changing it. What it does reuse is the
parts that encode domain rules — `lake.files_for_range` for which files to
open, `build_where` for the filter predicates, `needs_codr` for whether the
join is required, `SERVICE_TYPE_EXPR` for the classification. Those are the
things that must not drift from the dashboards, so they are imported, never
restated.

Filter values remain bound parameters throughout. The only text interpolated
here is file paths this application discovered and column expressions chosen
from the fixed tables below — never anything the model sent.
"""

import json
import logging
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter
from typing import Any, Iterator

import duckdb

from app.ai.providers.base import ToolSpec
from app.ai.tools.export_source import EXPORT_BATCH, ExportData, ExportUnavailable, connect
from app.ai.tools.windows import split
from app.cdr import lake, service
from app.cdr.filters import SERVICE_TYPE_EXPR, build_where, needs_codr
from app.core.config import get_settings
from app.schemas.cdr import CdrFilter

logger = logging.getLogger(__name__)

# The same code -> label mapping the dashboard uses, read from the same file so
# the two cannot disagree about what reason 35 is called.
_DISCONNECT_REASONS: dict[str, str] = json.loads(
    (Path(service.__file__).parent / "disconnect_reasons.json").read_text(encoding="utf-8")
)

# ── Dimensions ─────────────────────────────────────────────────────────────
# name -> (SQL expression, whether it needs the CODR join)
#
# Every expression is written against the `c` / `o` aliases the FROM clause
# below establishes, matching what build_where produces.

_CONNECTED = "(c.INCONF_DATETIME_EPOC IS NOT NULL AND c.INCONF_DATETIME_EPOC <> 0)"

DIMENSIONS: dict[str, tuple[str, bool]] = {
    "date": ("CAST(COALESCE(c.CALL_DATE, CAST(c.START_DATETIME AS DATE)) AS VARCHAR)", False),
    "hour": ("strftime(c.START_DATETIME, '%Y-%m-%d %H:00')", False),
    "location": ("'L' || CAST(c.LOCATION_ID AS VARCHAR)", False),
    "account": ("CAST(c.ACCOUNTID AS VARCHAR)", False),
    "service_provider": ("CAST(c.SERVICE_PROVIDER AS VARCHAR)", False),
    # CRN alone is reused across rooms; the pair is the room's identity.
    "conference": ("CAST(c.CRN AS VARCHAR) || '/' || CAST(c.CONF_NUM AS VARCHAR)", False),
    "direction": (
        "CASE c.CALLTYPE WHEN 0 THEN 'Dial In' WHEN 1 THEN 'Dial Out' ELSE 'Unknown' END",
        False,
    ),
    "disconnect_reason": ("CAST(c.DISCONNECT_REASON AS VARCHAR)", False),
    "blast": ("'Blast ' || CAST(c.CONFDIAL_REBLAST_COUNT AS VARCHAR)", False),
    # Needs MODULE_TYPE, so it forces the join.
    "service_type": (SERVICE_TYPE_EXPR, True),
}

# ── Measures ───────────────────────────────────────────────────────────────
# name -> SQL aggregate. Each encodes a domain rule that is easy to get wrong
# by hand, which is the point of offering them rather than leaving the model to
# write the arithmetic itself.

MEASURES: dict[str, str] = {
    "calls": "CAST(COUNT(*) AS BIGINT)",
    "connected": f"CAST(COUNT(*) FILTER (WHERE {_CONNECTED}) AS BIGINT)",
    "not_connected": f"CAST(COUNT(*) FILTER (WHERE NOT {_CONNECTED}) AS BIGINT)",
    # Percentage, not a fraction, and guarded against an empty group.
    "connect_rate": (
        f"ROUND(100.0 * COUNT(*) FILTER (WHERE {_CONNECTED}) / NULLIF(COUNT(*), 0), 2)"
    ),
    # Billable time: joining to release, connected rows only, rounded up — the
    # same formula as the dashboard's minutes_usage KPI.
    "minutes": (
        "CAST(COALESCE(SUM(CEIL((CASE WHEN c.INCONF_DATETIME_EPOC <> 0 "
        "THEN c.RELEASE_DATETIME_EPOC - c.INCONF_DATETIME_EPOC ELSE 0 END) / 60.0)), 0) AS BIGINT)"
    ),
    # Distinct subscribers, trailing 10 digits so one number dialled with and
    # without a prefix counts once. Blanks are not a number.
    "phone_numbers": (
        "CAST(COUNT(DISTINCT CASE WHEN c.CALLTYPE = 1 "
        "THEN RIGHT(CAST(c.TEL_DIGIT AS VARCHAR), 10) "
        "ELSE RIGHT(CAST(c.CLI AS VARCHAR), 10) END) "
        "FILTER (WHERE TRIM(COALESCE(CAST(c.TEL_DIGIT AS VARCHAR), CAST(c.CLI AS VARCHAR), '')) <> '') "
        "AS BIGINT)"
    ),
    "conferences": "CAST(COUNT(DISTINCT (c.CRN, c.CONF_NUM)) AS BIGINT)",
    "accounts": "CAST(COUNT(DISTINCT c.ACCOUNTID) AS BIGINT)",
    # Blast 0 is the initial dial, so a reblast is any later attempt.
    "reblasts": "CAST(COUNT(*) FILTER (WHERE c.CONFDIAL_REBLAST_COUNT > 0) AS BIGINT)",
    "dtmf_entries": (
        "CAST(COUNT(*) FILTER (WHERE c.DTMFDIGITS IS NOT NULL "
        "AND TRIM(CAST(c.DTMFDIGITS AS VARCHAR)) <> '') AS BIGINT)"
    ),
}

DEFAULT_MEASURES = ["calls", "connected", "connect_rate"]

# Dimensions that read as a sequence rather than a ranking — sorted by their
# own value, ascending, unless the caller says otherwise.
_SEQUENTIAL = {"date", "hour", "blast"}

MAX_ROWS = 500

QUERY_METRICS_TOOL = ToolSpec(
    name="query_metrics",
    description=(
        "THE PRIMARY TOOL. Aggregate any measures over any grouping, in one call — "
        "over any range up to a year, which it processes internally in windows; never "
        "split a range into several calls.\n"
        "Use it for every 'how many / how much / what rate' question, including "
        "totals with no grouping at all.\n"
        "  measures: calls (attempts), connected, not_connected, connect_rate (%), "
        "minutes (billable, connected legs only), phone_numbers (distinct subscribers), "
        "conferences (distinct CRN+CONF_NUM rooms), accounts, reblasts, dtmf_entries.\n"
        "  group_by: date, hour, location, account, service_provider, conference, "
        "direction (dial in/out), disconnect_reason, blast, service_type. "
        "Omit group_by for a single total row.\n"
        "Group by up to two dimensions to cross-tabulate (e.g. date + service_provider). "
        "NEVER call this once per day to build a daily series — pass group_by:['date'] "
        "and get every day in one call."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "measures": {
                "type": "array",
                "items": {"type": "string", "enum": list(MEASURES)},
                "description": "Figures to compute. Defaults to calls, connected and connect_rate.",
            },
            "group_by": {
                "type": "array",
                "items": {"type": "string", "enum": list(DIMENSIONS)},
                "maxItems": 2,
                "description": "Dimensions to break the measures down by. Omit for one total row.",
            },
            "date_from": {"type": "string", "format": "date", "description": "Inclusive, YYYY-MM-DD."},
            "date_to": {"type": "string", "format": "date", "description": "Inclusive, YYYY-MM-DD."},
            "service": {
                "type": "string",
                "enum": ["all", "voicedrop", "conference", "multicall"],
                "description": "Restrict to one service. Omit for no restriction.",
            },
            "account_id": {"type": "string", "description": "Restrict to one ACCOUNTID."},
            "crn": {"type": "string", "description": "Restrict to one CRN."},
            "order_by": {
                "type": "string",
                "description": (
                    "A measure name to rank by (largest first), or a dimension name to "
                    "sort by. Defaults to the dimension for date/hour/blast, else the "
                    "first measure."
                ),
            },
            "limit": {
                "type": "integer",
                "description": f"Maximum rows, up to {MAX_ROWS}. Use with order_by for a top-N.",
            },
        },
        "required": ["date_from", "date_to"],
    },
)


def _sql_list(paths) -> str:
    """Quote discovered file paths for read_parquet([...]) — never model input."""
    return "[" + ", ".join("'" + str(p).replace("'", "''") + "'" for p in paths) + "]"


def _as_list(value: Any) -> list[str]:
    """Accept a list, or a single string, or a comma-separated one."""
    if value is None:
        return []
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    if isinstance(value, (list, tuple)):
        return [str(v).strip() for v in value if str(v).strip()]
    return []


@dataclass
class _Plan:
    """One validated query_metrics call, ready to run over any range."""

    filters: CdrFilter
    measures: list[str]
    dims: list[str]
    # Whether the call needs CODR (a service filter on MODULE_TYPE, or the
    # service_type dimension).
    joined: bool
    order_sql: str | None
    # The model's own `limit`, when it asked for one ("top 10"). None means
    # "every row", capped only by whoever runs the plan.
    requested_limit: int | None


def _plan(
    date_from: Any = None,
    date_to: Any = None,
    measures: Any = None,
    group_by: Any = None,
    account_id: Any = None,
    crn: Any = None,
    order_by: Any = None,
    limit: Any = None,
    **extra: Any,
) -> tuple[_Plan | None, str | None]:
    """Validate a call. Returns (plan, None) or (None, error for the model).

    Shared by the tool (rows for the model, capped at MAX_ROWS) and by the file
    export (every row), so the two can never disagree about what was asked.
    """
    chosen_service = extra.pop("service", None)
    if extra:
        logger.info(f"query_metrics ignoring unknown arguments: {sorted(extra)}")

    settings = get_settings()

    wanted_measures = _as_list(measures) or list(DEFAULT_MEASURES)
    unknown = [m for m in wanted_measures if m not in MEASURES]
    if unknown:
        return None, f"Unknown measure(s): {', '.join(unknown)}. Available: {', '.join(MEASURES)}."

    wanted_dims = _as_list(group_by)
    unknown = [d for d in wanted_dims if d not in DIMENSIONS]
    if unknown:
        return None, f"Unknown dimension(s): {', '.join(unknown)}. Available: {', '.join(DIMENSIONS)}."
    if len(wanted_dims) > 2:
        return None, (
            f"group_by takes at most 2 dimensions; {len(wanted_dims)} were given. "
            "Pick the two that answer the question."
        )

    try:
        filters = CdrFilter.model_validate(
            {
                "date_from": date_from,
                "date_to": date_to,
                "service": chosen_service or None,
                "account_id": account_id,
                "crn": crn,
            },
            context={"max_range_days": settings.AI_MAX_RANGE_DAYS},
        )
    except Exception as exc:  # pydantic ValidationError, message written for the model
        message = "; ".join(
            line.strip() for line in str(exc).splitlines() if "Value error" in line
        ) or str(exc)
        return None, f"Those filters are not valid — {message}"

    if order_by in MEASURES and order_by in wanted_measures:
        order_sql = f'"{order_by}" DESC'
    elif order_by in DIMENSIONS and order_by in wanted_dims:
        order_sql = f'"{order_by}" ASC'
    elif wanted_dims and wanted_dims[0] in _SEQUENTIAL:
        # A date series reads in date order; ranking it by size scrambles it.
        order_sql = f'"{wanted_dims[0]}" ASC'
    elif wanted_dims:
        order_sql = f'"{wanted_measures[0]}" DESC'
    else:
        order_sql = None

    try:
        requested = max(int(limit), 1) if limit is not None else None
    except (TypeError, ValueError):
        requested = None

    joined = needs_codr(filters, want_service_type="service_type" in wanted_dims)
    return _Plan(filters, wanted_measures, wanted_dims, joined, order_sql, requested), None


# ── Windowed aggregation ───────────────────────────────────────────────────
#
# A long range is worked through AI_WINDOW_DAYS at a time: each window writes a
# small partial result into a staging table, and one final query combines
# them. That is exact, not an estimate, because every measure is stored in a
# form that merges correctly:
#
#   additive   counts and sums — the window subtotals are added
#   rate       connect_rate — recomputed from the merged connected and calls
#   distinct   phone_numbers, conferences, accounts — the windows' distinct
#              keys are kept and counted once, so a number seen in two windows
#              is still one number

_ADDITIVE: dict[str, str] = {
    "calls": "COUNT(*)",
    "connected": f"COUNT(*) FILTER (WHERE {_CONNECTED})",
    "not_connected": f"COUNT(*) FILTER (WHERE NOT {_CONNECTED})",
    "minutes": (
        "COALESCE(SUM(CEIL((CASE WHEN c.INCONF_DATETIME_EPOC <> 0 "
        "THEN c.RELEASE_DATETIME_EPOC - c.INCONF_DATETIME_EPOC ELSE 0 END) / 60.0)), 0)"
    ),
    "reblasts": "COUNT(*) FILTER (WHERE c.CONFDIAL_REBLAST_COUNT > 0)",
    "dtmf_entries": (
        "COUNT(*) FILTER (WHERE c.DTMFDIGITS IS NOT NULL "
        "AND TRIM(CAST(c.DTMFDIGITS AS VARCHAR)) <> '')"
    ),
}

# measure -> (key expression, filter on the rows that count)
_DISTINCT: dict[str, tuple[str, str]] = {
    "phone_numbers": (
        "CASE WHEN c.CALLTYPE = 1 THEN RIGHT(CAST(c.TEL_DIGIT AS VARCHAR), 10) "
        "ELSE RIGHT(CAST(c.CLI AS VARCHAR), 10) END",
        "TRIM(COALESCE(CAST(c.TEL_DIGIT AS VARCHAR), CAST(c.CLI AS VARCHAR), '')) <> ''",
    ),
    "conferences": ("CAST(c.CRN AS VARCHAR) || '/' || CAST(c.CONF_NUM AS VARCHAR)", "TRUE"),
    "accounts": ("CAST(c.ACCOUNTID AS VARCHAR)", "TRUE"),
}


def _from_clause(plan: _Plan, start, end) -> tuple[str | None, str | None]:
    """FROM for one stretch of days. Returns (clause, None), (None, None) when
    the lake holds no CDR for it, or (None, reason) when it cannot be read."""
    try:
        cdr_files = lake.files_for_range("cdr", start, end)
    except lake.LakeUnavailable as exc:
        return None, str(exc)
    if not cdr_files:
        return None, None

    clause = f"FROM read_parquet({_sql_list(cdr_files)}, union_by_name = true) c"
    if plan.joined:
        # CODR for the whole requested range, not just this window: a room's
        # CODR row is filed under one day, and its CDR legs can fall in the
        # window next door (a conference running past midnight). Joining the
        # full range is what the single query does, so the windows agree with
        # it exactly — and CODR, one row per room, is small next to CDR.
        try:
            codr_files = lake.files_for_range("codr", plan.filters.date_from, plan.filters.date_to)
        except lake.LakeUnavailable as exc:
            return None, str(exc)
        if not codr_files:
            return None, (
                f"That grouping or service filter needs CODR, but there are no CODR "
                f"export files for {start} to {end}."
            )
        clause += (
            f"\n    LEFT JOIN read_parquet({_sql_list(codr_files)}, union_by_name = true) o"
            "\n           ON o.CRN = c.CRN AND o.CONF_NUM = c.CONF_NUM"
        )
    return clause, None


def _dim_select(plan: _Plan) -> list[str]:
    return [f'{DIMENSIONS[d][0]} AS "{d}"' for d in plan.dims]


def _group_by(plan: _Plan) -> str:
    return ("\n    GROUP BY " + ", ".join(str(i + 1) for i in range(len(plan.dims)))) if plan.dims else ""


class _NoData(Exception):
    pass


def _execute(plan: _Plan, con, cap: int):
    """Run a plan and return (cursor, notes). Raises ValueError for the model."""
    filters = plan.filters
    windows = split(filters.date_from, filters.date_to, get_settings().AI_WINDOW_DAYS)

    if len(windows) == 1:
        clause, problem = _from_clause(plan, filters.date_from, filters.date_to)
        if problem:
            raise ValueError(problem)
        if clause is None:
            raise _NoData()
        where = build_where(filters)
        select = _dim_select(plan) + [f'{MEASURES[m]} AS "{m}"' for m in plan.measures]
        sql = f"SELECT {', '.join(select)}\n    {clause}\n    {where.sql}{_group_by(plan)}"
        if plan.order_sql:
            sql += f"\n    ORDER BY {plan.order_sql}"
        sql += "\n    LIMIT ?"
        return con.execute(sql, [*where.params, cap]), []

    additive = sorted({
        name
        for m in plan.measures
        for name in (("calls", "connected") if m == "connect_rate" else (m,))
        if name in _ADDITIVE
    } | {"calls"})
    distinct = [m for m in plan.measures if m in _DISTINCT]

    notes: list[str] = []
    covered = 0
    for start, end in windows:
        clause, problem = _from_clause(plan, start, end)
        if problem:
            # One unreadable window should not cost the whole answer; it is
            # reported alongside the figures instead.
            notes.append(f"{start} to {end} skipped: {problem}")
            continue
        if clause is None:
            continue
        where = build_where(filters.model_copy(update={"date_from": start, "date_to": end}))

        partial = _dim_select(plan) + [f'{_ADDITIVE[a]} AS "p_{a}"' for a in additive]
        verb = "INSERT INTO part_add" if covered else "CREATE TEMP TABLE part_add AS"
        con.execute(
            f"{verb} SELECT {', '.join(partial)}\n    {clause}\n    {where.sql}{_group_by(plan)}",
            where.params,
        )
        for m in distinct:
            key, keep = _DISTINCT[m]
            select = _dim_select(plan) + [f"{key} AS k"]
            verb = f"INSERT INTO part_{m}" if covered else f"CREATE TEMP TABLE part_{m} AS"
            con.execute(
                f"{verb} SELECT DISTINCT {', '.join(select)}\n    {clause}\n    {where.sql} AND {keep}",
                where.params,
            )
        covered += 1

    if not covered:
        if notes:
            raise ValueError("; ".join(notes))
        raise _NoData()

    dims = [f'"{d}"' for d in plan.dims]
    dim_list = ", ".join(dims)
    group = f" GROUP BY {dim_list}" if dims else ""
    sources = [
        f"(SELECT {dim_list + ', ' if dims else ''}"
        + ", ".join(f'SUM("p_{a}") AS "p_{a}"' for a in additive)
        + f" FROM part_add{group}) a"
    ]
    for m in distinct:
        sources.append(
            f"(SELECT {dim_list + ', ' if dims else ''}COUNT(DISTINCT k) AS \"{m}\" FROM part_{m}{group}) d_{m}"
        )

    # Groups are driven by the additive table, which every row passes through;
    # the distinct tables join to it on the dimensions. NULL-safe, because a
    # missing account or provider is a group of its own.
    from_sql = sources[0]
    for m, source in zip(distinct, sources[1:]):
        on = " AND ".join(f'a.{d} IS NOT DISTINCT FROM d_{m}.{d}' for d in dims) or "TRUE"
        from_sql += f"\n    LEFT JOIN {source} ON {on}"

    finals = [f"a.{d} AS {d}" for d in dims]
    for m in plan.measures:
        if m == "connect_rate":
            finals.append('ROUND(100.0 * a."p_connected" / NULLIF(a."p_calls", 0), 2) AS "connect_rate"')
        elif m in _ADDITIVE:
            finals.append(f'CAST(a."p_{m}" AS BIGINT) AS "{m}"')
        else:
            finals.append(f'CAST(COALESCE(d_{m}."{m}", 0) AS BIGINT) AS "{m}"')

    sql = f"SELECT {', '.join(finals)}\n    FROM {from_sql}"
    if plan.order_sql:
        sql += f"\n    ORDER BY {plan.order_sql}"
    sql += "\n    LIMIT ?"
    notes.insert(0, f"Worked through {len(windows)} windows of up to {get_settings().AI_WINDOW_DAYS} days.")
    return con.execute(sql, [cap]), notes


def _label_row(plan: _Plan, row: dict[str, Any]) -> dict[str, Any]:
    # Disconnect codes are meaningless as numbers; map them the way the
    # dashboard does, so the model reports the same words a chart would.
    if "disconnect_reason" in plan.dims:
        row["disconnect_reason"] = _DISCONNECT_REASONS.get(str(row["disconnect_reason"]), "Unknown")
    return row


def query_metrics(**arguments: Any) -> tuple[str, bool]:
    """Aggregate measures over dimensions. Returns (content, is_error)."""
    plan, error = _plan(**arguments)
    if error:
        return (error, True)

    row_limit = min(plan.requested_limit or MAX_ROWS, MAX_ROWS)
    filters = plan.filters
    started = perf_counter()

    try:
        with connect() as con:
            cursor, notes = _execute(plan, con, row_limit)
            columns = [d[0] for d in cursor.description]
            rows = [_label_row(plan, dict(zip(columns, row))) for row in cursor.fetchall()]
    except _NoData:
        return (
            f"No CDR export files for {filters.date_from} to {filters.date_to} in "
            f"{lake.root('cdr')}. Try a different date range.",
            True,
        )
    except ValueError as exc:
        return (str(exc), True)
    except duckdb.Error as exc:
        logger.error(f"query_metrics failed: {exc}")
        return (f"The query failed: {exc}", True)

    logger.info(
        f"AI query_metrics measures={plan.measures} group_by={plan.dims or ['(total)']} "
        f"range={filters.date_from}..{filters.date_to} service={filters.service or 'all'} "
        f"rows={len(rows)} seconds={perf_counter() - started:.1f}"
    )

    if not rows:
        return ("0 rows. The filters matched nothing in this range.", False)

    payload: dict[str, Any] = {
        "date_from": filters.date_from.isoformat(),
        "date_to": filters.date_to.isoformat(),
        "service": filters.service or "all",
        "group_by": plan.dims,
        "measures": plan.measures,
        "row_count": len(rows),
        "rows": rows,
    }
    if notes:
        payload["notes"] = notes
    if len(rows) >= row_limit:
        payload["truncated"] = True
        payload["note"] = (
            f"Truncated at {row_limit} rows. Narrow the range or group by fewer "
            "dimensions if a complete answer needs more."
        )

    return (json.dumps(payload, default=str), False)


@contextmanager
def export_rows(arguments: dict[str, Any], max_rows: int) -> Iterator[ExportData]:
    """The same query as the tool, streamed for a file instead of the model.

    Not capped at MAX_ROWS — only at `max_rows`, and at the model's own `limit`
    when it asked for one, since "top 10" means ten rows in the file too.
    """
    plan, error = _plan(**dict(arguments))
    if error:
        raise ExportUnavailable(error)

    cap = min(plan.requested_limit or max_rows, max_rows)
    with connect() as con:
        try:
            cursor, _ = _execute(plan, con, cap)
        except _NoData as exc:
            raise ExportUnavailable("There is no data in that range.") from exc
        except (ValueError, duckdb.Error) as exc:
            raise ExportUnavailable(str(exc)) from exc
        columns = [d[0] for d in cursor.description]

        def batches() -> Iterator[list[tuple]]:
            label = "disconnect_reason" in plan.dims
            index = columns.index("disconnect_reason") if label else -1
            while chunk := cursor.fetchmany(EXPORT_BATCH):
                if label:
                    chunk = [
                        row[:index]
                        + (_DISCONNECT_REASONS.get(str(row[index]), "Unknown"),)
                        + row[index + 1:]
                        for row in chunk
                    ]
                yield chunk

        filters = plan.filters
        yield ExportData(
            columns=columns,
            batches=batches(),
            cap=cap,
            description=(
                f"query_metrics {', '.join(plan.measures)}"
                + (f" by {', '.join(plan.dims)}" if plan.dims else "")
                + f" | {filters.date_from} to {filters.date_to}"
                + f" | service {filters.service or 'all'}"
            ),
        )
