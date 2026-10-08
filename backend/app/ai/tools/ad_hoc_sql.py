"""
Tier B — free-form SQL, for the questions the panel catalogue can't express.

Every call runs against a **fresh, throwaway DuckDB connection** holding two
temp tables built from exactly the days requested. Nothing is shared between
requests, so one question can't see or affect another's state, and the model
never learns a file path because there isn't one to learn: it queries `cdr` and
`codr`, and this module decides which files those are.

The defence is two independent layers, in this order:

1. `sql_guard.validate` — text validation, which rejects early and explains
   itself in terms the model can act on. Necessarily a denylist.
2. `SET disabled_filesystems='LocalFileSystem'` — applied *after* the temp
   tables are materialised and before the model's SQL runs. From that point the
   connection cannot open a file at all, and the setting cannot be reset
   (verified on DuckDB 1.5.5). This is the layer that actually holds: it does
   not depend on the guard having thought of every spelling.

Order matters and is the whole trick. The tables are built with the application
reading files, then the ability to read files is destroyed, and only then does
generated SQL execute.

Every call is logged — range, purpose, SQL, row count, outcome. This is
production call-detail data, and an AI-generated query against it needs the
same audit trail as any other.
"""

import json
import logging
import re
from contextlib import contextmanager
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any, Iterator

import duckdb

from app.ai import sql_guard
from app.ai.providers.base import ToolSpec
from app.ai.tools.export_source import EXPORT_BATCH, ExportData, ExportUnavailable, connect
from app.cdr import lake, service
from app.core.config import get_settings

logger = logging.getLogger(__name__)

RUN_QUERY_TOOL = ToolSpec(
    name="run_cdr_query",
    description=(
        "Run one read-only DuckDB SELECT over CDR/CODR for a date range. The tables "
        "'cdr' and 'codr' are already loaded for exactly the range you name — never "
        "reference file paths. Use this only when get_cdr_panel cannot answer the "
        "question. Alias cdr AS c and codr AS o, and join on BOTH keys "
        "(o.CRN = c.CRN AND o.CONF_NUM = c.CONF_NUM)."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "date_from": {"type": "string", "format": "date", "description": "Inclusive start, YYYY-MM-DD."},
            "date_to": {"type": "string", "format": "date", "description": "Inclusive end, YYYY-MM-DD."},
            "sql": {
                "type": "string",
                "description": "One DuckDB SELECT over cdr/codr. No semicolon.",
            },
            "purpose": {
                "type": "string",
                "description": "One line: what this answers. For the audit log.",
            },
        },
        "required": ["date_from", "date_to", "sql", "purpose"],
    },
)


# Stands in when the range has CDR files but no CODR ones. Only the columns a
# question could plausibly join or group on — enough that a query binds and
# returns nothing, which is the honest answer when there is no CODR to match.
_EMPTY_CODR_SQL = """CREATE TEMP TABLE codr (
    CRN BIGINT, CONF_NUM BIGINT, MODULE_TYPE INTEGER,
    ACCOUNT_ID VARCHAR, ACCOUNT_NAME VARCHAR,
    CLIENT_ID VARCHAR, CLIENT_NAME VARCHAR,
    CONFERENCE_NAME VARCHAR, BOOKING_CODE VARCHAR, BILLING_CODE VARCHAR,
    CHAIR_PIN VARCHAR, CHAIR_NAME VARCHAR,
    PEAK_CONFEREE_COUNT INTEGER, RESERVED_MAX_CONFEREE INTEGER,
    START_DATETIME TIMESTAMP, END_DATETIME TIMESTAMP,
    START_DATETIME_EPOC BIGINT, END_DATETIME_EPOC BIGINT
)"""


def _parse_day(value: Any, field: str) -> date:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    try:
        return date.fromisoformat(str(value).strip()[:10])
    except (ValueError, AttributeError, TypeError) as exc:
        raise ValueError(f"{field} must be a date as YYYY-MM-DD, not {value!r}.") from exc


def _jsonable(value: Any) -> Any:
    """DuckDB returns types the JSON encoder won't take verbatim."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value).hex()
    return value


def _sql_list(paths) -> str:
    """Quote discovered file paths for read_parquet([...]).

    These are paths this application found in its own configured directories —
    never model input. A path cannot be a bound parameter because DuckDB needs
    it at plan time, which is exactly why the filesystem is disabled the moment
    these reads are done.
    """
    return "[" + ", ".join("'" + str(p).replace("'", "''") + "'" for p in paths) + "]"


# `SELECT *`, `c.*` — a statement that takes every column. `COUNT(*)` does not.
_STAR = re.compile(r"(?:\bselect|,)\s*(?:distinct\s+)?(?:\w+\.)?\*", re.IGNORECASE)
# Always kept: the date filter below needs these, and the join needs the keys.
_CDR_ALWAYS = {"CALL_DATE", "START_DATETIME", "CRN", "CONF_NUM"}
_CODR_ALWAYS = {"CRN", "CONF_NUM"}


def _columns_for(con: duckdb.DuckDBPyConnection, files: list, sql: str | None, always: set[str]) -> str:
    """The projection to materialise: only the columns the statement mentions.

    A day of CDR has 42 columns, and copying every one of them for every day of
    the range is what exhausted memory on long ranges. A column the SQL never
    names cannot change its result, so it is left on disk. Anything that asks
    for every column (`SELECT *`, `c.*`) gets every column.
    """
    if not sql or _STAR.search(sql):
        return "*"
    available = [row[0] for row in con.execute(
        f"DESCRIBE SELECT * FROM read_parquet({_sql_list(files)}, union_by_name = true)"
    ).fetchall()]
    mentioned = {word.upper() for word in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", sql)}
    keep = [c for c in available if c.upper() in mentioned or c.upper() in always]
    return ", ".join(f'"{c}"' for c in keep) if keep else "*"


def _prepare(
    con: duckdb.DuckDBPyConnection, date_from: date, date_to: date, sql: str | None = None
) -> None:
    """Materialise `cdr` and `codr` for the range, then lock the filesystem.

    Raises DatasetNotReady when the CDR side has nothing for the range — an
    empty answer must never be indistinguishable from a quiet week.
    """
    try:
        cdr_files = lake.files_for_range("cdr", date_from, date_to)
        codr_files = lake.files_for_range("codr", date_from, date_to)
    except lake.LakeUnavailable as exc:
        raise service.DatasetNotReady(str(exc)) from exc

    if not cdr_files:
        raise service.DatasetNotReady(
            f"No CDR export files for {date_from} to {date_to} in {lake.root('cdr')}. "
            "Try a different date range."
        )

    # The date predicate is applied here as well as in file selection: a file is
    # named for a day, but nothing guarantees every row inside it falls on that
    # day, and the range endpoints have to be exact. Same rule as filters.py.
    con.execute(
        f"CREATE TEMP TABLE cdr AS SELECT {_columns_for(con, cdr_files, sql, _CDR_ALWAYS)} "
        f"FROM read_parquet({_sql_list(cdr_files)}, union_by_name = true) "
        "WHERE COALESCE(CALL_DATE, CAST(START_DATETIME AS DATE)) BETWEEN ? AND ?",
        [date_from, date_to],
    )

    if codr_files:
        con.execute(
            f"CREATE TEMP TABLE codr AS SELECT {_columns_for(con, codr_files, sql, _CODR_ALWAYS)} "
            f"FROM read_parquet({_sql_list(codr_files)}, union_by_name = true)"
        )
    else:
        # An empty table of the right shape, not a missing one: a join against
        # it returns no CODR-side rows, which is the truth. A missing table
        # would instead fail the query with a binder error the model would
        # waste its remaining rounds trying to work around.
        con.execute(_EMPTY_CODR_SQL)
        logger.warning(f"No CODR files for {date_from}..{date_to}; codr is an empty stub table.")

    # Everything above this line needed the filesystem. Nothing below it does.
    # Irreversible for the life of this connection — verified on DuckDB 1.5.5,
    # where a subsequent RESET raises rather than re-enabling access.
    try:
        con.execute("SET disabled_filesystems='LocalFileSystem'")
    except duckdb.Error as exc:
        # Not fatal, but it drops the design to text-validation-only, which is
        # worth a loud line in the log rather than a silent downgrade.
        logger.error(
            f"Could not disable the local filesystem on this DuckDB build ({exc}). "
            "Ad-hoc AI SQL is protected by text validation alone."
        )


def _checked_range(date_from: Any, date_to: Any) -> tuple[date, date]:
    """The inclusive range, validated. Raises ValueError with a message for the model."""
    start = _parse_day(date_from, "date_from")
    end = _parse_day(date_to, "date_to")
    if end < start:
        raise ValueError(f"date_to ({end}) is before date_from ({start}).")
    span = (end - start).days + 1
    limit = get_settings().AI_DIRECT_MAX_RANGE_DAYS
    if span > limit:
        raise ValueError(
            f"That range spans {span} days; ad-hoc queries are limited to "
            f"{limit}. Narrow the range, or use get_cdr_panel, "
            "which can cover a longer one."
        )
    return start, end


def run_cdr_query(
    date_from: str | None = None,
    date_to: str | None = None,
    sql: str | None = None,
    purpose: str = "",
    **extra: Any,
) -> tuple[str, bool]:
    """Validate, execute and serialise one ad-hoc query. Returns (content, is_error)."""
    if extra:
        logger.info(f"run_cdr_query ignoring unknown arguments: {sorted(extra)}")

    settings = get_settings()

    # ── 1. The range ───────────────────────────────────────────────────────
    try:
        start, end = _checked_range(date_from, date_to)
    except ValueError as exc:
        return (str(exc), True)

    # ── 2. The statement ───────────────────────────────────────────────────
    try:
        guarded = sql_guard.validate(sql or "")
    except sql_guard.SqlNotAllowed as exc:
        logger.warning(f"AI SQL rejected | purpose={purpose!r} | reason={exc} | sql={sql!r}")
        return (str(exc), True)

    # ── 3-5. Execute ───────────────────────────────────────────────────────
    try:
        with connect() as con:
            _prepare(con, start, end, sql)
            cursor = con.execute(guarded)
            columns = [d[0] for d in cursor.description]
            rows = [
                {col: _jsonable(val) for col, val in zip(columns, row)}
                for row in cursor.fetchall()
            ]
    except service.DatasetNotReady as exc:
        logger.warning(f"AI SQL not ready | {start}..{end} | purpose={purpose!r} | {exc}")
        return (str(exc), True)
    except duckdb.Error as exc:
        logger.warning(f"AI SQL failed | {start}..{end} | purpose={purpose!r} | {exc} | sql={sql!r}")
        # The engine's own message is the most useful thing the model can get
        # here — it names the bad column or the syntax error precisely.
        return (f"The query failed: {exc}", True)

    # ── 6. Audit ───────────────────────────────────────────────────────────
    logger.info(
        f"AI SQL ok | {start}..{end} | rows={len(rows)} | purpose={purpose!r} | "
        f"sql={' '.join((sql or '').split())}"
    )

    if not rows:
        # Explicitly not an error: "nothing matched" is a real answer, and
        # flagging it as a failure sends the model looking for a bug instead.
        return ("0 rows. The filters matched nothing in this range.", False)

    payload: dict[str, Any] = {
        "row_count": len(rows),
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "rows": rows,
    }
    if len(rows) >= settings.AI_MAX_ROWS_TO_MODEL:
        # The cap is structural, so the model has no other way to notice it hit
        # one — and reporting a capped list as complete would be a wrong answer.
        payload["truncated"] = True
        payload["note"] = (
            f"Truncated at {settings.AI_MAX_ROWS_TO_MODEL} rows. Aggregate further, "
            "or narrow the range, if a complete answer needs more."
        )

    return (json.dumps(payload, default=str), False)


@contextmanager
def export_rows(arguments: dict[str, Any], max_rows: int) -> Iterator[ExportData]:
    """The same statement as the tool ran, streamed for a file.

    The same two defence layers apply — the guard, then the locked filesystem —
    with only the outer row cap raised. The model's own LIMIT, if it wrote one,
    is inside the wrapped statement and still holds.
    """
    try:
        start, end = _checked_range(arguments.get("date_from"), arguments.get("date_to"))
        guarded = sql_guard.validate(arguments.get("sql") or "", limit=max_rows)
    except (ValueError, sql_guard.SqlNotAllowed) as exc:
        raise ExportUnavailable(str(exc)) from exc

    with connect() as con:
        try:
            _prepare(con, start, end, arguments.get("sql"))
            cursor = con.execute(guarded)
        except (service.DatasetNotReady, duckdb.Error) as exc:
            raise ExportUnavailable(str(exc)) from exc
        columns = [d[0] for d in cursor.description]

        def batches() -> Iterator[list[tuple]]:
            while chunk := cursor.fetchmany(EXPORT_BATCH):
                yield chunk

        purpose = str(arguments.get("purpose") or "").strip()
        logger.info(f"AI SQL export | {start}..{end} | cap={max_rows} | purpose={purpose!r}")
        yield ExportData(
            columns=columns,
            batches=batches(),
            cap=max_rows,
            description=f"run_cdr_query | {start} to {end}" + (f" | {purpose}" if purpose else ""),
            notes=[f"SQL: {' '.join(str(arguments.get('sql') or '').split())}"],
        )
