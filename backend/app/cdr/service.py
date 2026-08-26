"""
Query execution against the CDR/CODR parquet lake.

Two things keep this fast on a network share, and both are the point of the
module:

1. **Only the days asked for are opened.** The date range resolves to a list of
   daily files by name (lake.py), so a one-day query reads one file out of the
   ~250 the lake holds.

2. **A dashboard load is one pass, not eight.** `compute_panels` materialises
   the filtered slice once and derives every panel from it in the same
   statement. Reading a day costs seconds; reading it eight times costs most of
   a minute.

CODR is joined only when the answer depends on it — filtering to conference or
multicall, or reporting SERVICE_TYPE — because those are the only cases CDR
cannot settle alone (see filters.py).

Filter values are always bound parameters. The only text this module
interpolates is file paths and a bucket unit it chooses itself.
"""

import json
import logging
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable

import duckdb

from app.cdr import lake
from app.cdr.filters import SERVICE_TYPE_EXPR, WhereClause, build_where, needs_codr
from app.core.config import get_settings
from app.schemas.cdr import CdrFilter, CdrRecordsRequest

# Same mapping as the call_direction panel above — this has to stay in sync
# with it, since Blast Details cross-references cube rows against the labels
# that chart already shows.
_CALL_DIRECTION_EXPR = "CASE c.CALLTYPE WHEN 0 THEN 'Dial In' WHEN 1 THEN 'Dial Out' ELSE 'Unknown' END"

logger = logging.getLogger(__name__)

# Code -> reason label for the disconnect breakdown. Kept as data rather than a
# SQL CASE so new codes can be mapped without touching a query; a code not yet
# in this file reports as "Unknown" instead of being dropped.
_DISCONNECT_REASONS: dict[str, str] = json.loads(
    (Path(__file__).parent / "disconnect_reasons.json").read_text(encoding="utf-8")
)

# Every panel the single-pass dashboard query can produce.
DASHBOARD_PANELS = (
    "summary",
    "dtmf",
    "call_direction",
    "connection_status",
    "peak_ports",
    "service_provider",
    "reblast",
    "disconnect_reason",
    "location",
    "minutes_by_location",
    "reblast_aid",
    "call_funnel",
    "call_funnel_direction",
    "call_duration",
    "call_duration_direction",
)

# Fixed display order for the two bucketed panels — sorting by count would
# scramble a sequence that's meant to read left to right.
_FUNNEL_STAGE_ORDER = {"Call Initiated": 0, "Call Ringed": 1, "Call Connected": 2, "Call Ended": 3}
_DURATION_BUCKET_ORDER = {"0-10": 0, "11-30": 1, "31-60": 2, "60+": 3}

# Same mapping as call_direction's CASE below — kept as one constant since the
# two direction-split panels both need it and have to stay in step with it.
_DIRECTION_EXPR = "CASE CALLTYPE WHEN 0 THEN 'Dial In' WHEN 1 THEN 'Dial Out' ELSE 'Unknown' END"


def _direction_split_sql(panel: str, stages: list[tuple[str, str]]) -> str:
    """
    A (panel, label, value) UNION-ALL block per stage, each further split by
    dial direction via a "<stage>::<direction>" label — decoded back into
    {label, dial_in, dial_out} rows by _split_by_direction in _shape.

    Kept in the same (panel, label, value) triple every other branch uses so
    this still stacks into the single dashboard statement instead of costing
    its own read of the range.
    """
    branches = [
        f"""
    SELECT '{panel}' AS panel,
           '{stage}::' || {_DIRECTION_EXPR} AS label,
           CAST(COUNT(*) FILTER (WHERE {condition}) AS DOUBLE) AS value
    FROM slice GROUP BY 2"""
        for stage, condition in stages
    ]
    return "\nUNION ALL".join(branches)


class DatasetNotReady(RuntimeError):
    """The lake can't answer: directory unreachable, or no files in the range."""


# ── Source assembly ────────────────────────────────────────────────────────


def _sql_list(paths: Iterable[Path]) -> str:
    """
    Quote a list of file paths for read_parquet([...]).

    These are paths this application discovered in its own configured
    directories, never caller input — a caller only ever picks a date range,
    and a file path cannot be a bound parameter since DuckDB needs it at plan
    time.
    """
    return "[" + ", ".join("'" + str(p).replace("'", "''") + "'" for p in paths) + "]"


def _from_clause(f: CdrFilter, joined: bool) -> tuple[str, int]:
    """
    The FROM (and, when needed, the LEFT JOIN), plus how many days it covers.

    Raises DatasetNotReady when the range resolves to no files at all — an
    empty chart would otherwise be indistinguishable from a quiet week.
    """
    try:
        cdr_files = lake.files_for_range("cdr", f.date_from, f.date_to)
    except lake.LakeUnavailable as exc:
        raise DatasetNotReady(str(exc)) from exc

    if not cdr_files:
        raise DatasetNotReady(
            f"No CDR export files for {f.date_from} to {f.date_to} in {lake.root('cdr')}."
        )

    clause = f"FROM read_parquet({_sql_list(cdr_files)}) c"

    if joined:
        try:
            codr_files = lake.files_for_range("codr", f.date_from, f.date_to)
        except lake.LakeUnavailable as exc:
            raise DatasetNotReady(str(exc)) from exc
        if not codr_files:
            raise DatasetNotReady(
                f"Conference and multicall need CODR, but there are no CODR export "
                f"files for {f.date_from} to {f.date_to} in {lake.root('codr')}."
            )
        # CRN alone is reused across rooms; CONF_NUM makes the pair unique, so
        # this matches at most one CODR record per CDR row and cannot fan out.
        clause += (
            f"\n    LEFT JOIN read_parquet({_sql_list(codr_files)}) o"
            "\n           ON o.CRN = c.CRN AND o.CONF_NUM = c.CONF_NUM"
        )

    return clause, len(cdr_files)


def _bucket_unit(span_days: int) -> str:
    """
    How wide one peak-ports bucket should be for a range this long.

    Per-minute is the useful resolution for a single day, but a month of it is
    44,000 points — past the row cap and past what a chart can show. The unit
    widens with the range so the series stays a readable few hundred points.
    """
    if span_days <= 3:
        return "minute"
    if span_days <= 90:
        return "hour"
    return "day"


_BUCKET_FORMAT = {"minute": "%Y-%m-%d %H:%M", "hour": "%Y-%m-%d %H:00", "day": "%Y-%m-%d"}


# ── Execution ──────────────────────────────────────────────────────────────


def _jsonable(value: Any) -> Any:
    """DuckDB hands back types the JSON encoder doesn't take verbatim."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value).hex()
    return value


def _connect() -> duckdb.DuckDBPyConnection:
    """A fresh in-process connection. Requests stay isolated; there is no server."""
    return duckdb.connect()


def _run(sql: str, params: list[Any]) -> list[dict[str, Any]]:
    """Execute and return rows as dicts. `params` are bound, never interpolated."""
    try:
        with _connect() as con:
            cursor = con.execute(sql, params)
            columns = [d[0] for d in cursor.description]
            return [
                {col: _jsonable(val) for col, val in zip(columns, row)}
                for row in cursor.fetchall()
            ]
    except duckdb.Error as exc:
        logger.error(f"CDR query failed: {exc}")
        raise DatasetNotReady(f"Query failed against the lake: {exc}") from exc


def _applied(f: CdrFilter, where: WhereClause, joined: bool) -> dict[str, Any]:
    """Echo back what actually narrowed the query."""
    return {
        "predicates": where.sql,
        "codr_joined": joined,
        **{k: v for k, v in f.model_dump(mode="json").items() if v not in (None, "")},
    }


# ── The slice ──────────────────────────────────────────────────────────────
# One projected, filtered, enriched view of the range that every panel reads.
# Only the columns the panels actually use are projected: on a network share
# the parquet reader skips the rest entirely, which is most of the 42.

_SLICE_COLUMNS = """c.CALLTYPE,
           c.LOCATION_ID,
           c.SERVICE_PROVIDER,
           c.DISCONNECT_REASON,
           c.AID_COUNT,
           c.CONFDIAL_REBLAST_COUNT,
           c.DTMFDIGITS,
           c.CRN,
           c.CONF_NUM,
           c.CONFEREE_SEQ_NO,
           -- The number on the other end of the leg. Which column holds it
           -- depends on the direction: TEL_DIGIT is "phone number for Dial Out
           -- calls" (data dictionary #11) and CLI "phone number for Dial In
           -- calls" (#9), and CALLTYPE = 1 is Dial Out here (see the note in
           -- campaign_service.py for how that was settled against the columns).
           -- Trailing 10 digits only, so the same subscriber counts once
           -- however it was dialled — with or without a country or trunk prefix.
           CASE WHEN c.CALLTYPE = 1
                THEN RIGHT(CAST(c.TEL_DIGIT AS VARCHAR), 10)
                ELSE RIGHT(CAST(c.CLI AS VARCHAR), 10) END AS PHONE_NUMBER,
           c.START_DATETIME,
           -- Call-funnel stage timestamps (data dictionary #12-15). PROCEEDING
           -- and ALERT are dial-out only, which is what makes this panel
           -- meaningful for Voicedrop specifically.
           c.PROCEEDING,
           c.ALERT,
           c.DISCONNECT_DATETIME,
           -- The moment the port is handed back, and the end of the interval
           -- the peak-ports sweep below measures. Guarded two ways: a null
           -- release makes the call instantaneous rather than unbounded, and a
           -- release stamped *before* its own start (1,475 rows in one sampled
           -- day) is clamped, so it can never retire a port it never took.
           GREATEST(COALESCE(c.RELEASE_DATETIME, c.START_DATETIME), c.START_DATETIME)
               AS PORT_RELEASE,
           -- Per the data dictionary INCONF is what decides whether a person
           -- actually joined; epoch 0 or null means they never did.
           (c.INCONF_DATETIME_EPOC IS NOT NULL AND c.INCONF_DATETIME_EPOC <> 0)
               AS IS_CONNECTED,
           -- Billable time runs from joining to release, and only for those
           -- who joined — an unanswered blast bills nothing.
           CASE WHEN c.INCONF_DATETIME_EPOC <> 0
                THEN c.RELEASE_DATETIME_EPOC - c.INCONF_DATETIME_EPOC
                ELSE 0 END AS CONNECTED_SECONDS"""

# ── Peak ports: an interval sweep ──────────────────────────────────────────
# Ports occupied is a concurrency question, so it is answered the way the
# existing peakport_voicedrop.py report answers it: +1 when a call takes a
# port, -1 when it releases one, running total over time, then the maximum
# reached within each bucket.
#
# The obvious alternative — MAX(CURRENT_PORT_COUNT) grouped by the minute a
# call started — was what this module did before, and it is wrong twice over.
# It reports nothing at all for a minute in which no call happened to start
# (1,258 of 1,440 minutes on one sampled day), and CURRENT_PORT_COUNT itself
# carries sentinel values: it peaked at 65535 on that day against a true
# concurrency of 1,001.
#
# Two refinements on the reference implementation, both measured:
#
#   * Ties are broken with releases before starts (ORDER BY ts, delta). A port
#     handed back at the same instant another is taken was never held twice.
#     This also makes the running total deterministic, which an unordered tie
#     in a parallel window function is not.
#
#   * A bucket containing no event carries the previous bucket's closing value
#     forward, rather than reading zero. The reference resamples and fills
#     gaps with 0, which is harmless for voicedrop (short calls, genuinely idle
#     gaps) but understates long calls: on one sampled day 109 conference
#     minutes held up to 82 ports while no event occurred in them.
_SWEEP_CTES = """,
ports_event AS (
    SELECT START_DATETIME AS ts,  1 AS delta FROM slice
    UNION ALL
    SELECT PORT_RELEASE,         -1        FROM slice
),
ports_running AS (
    SELECT ts,
           SUM(delta) OVER (ORDER BY ts, delta ROWS UNBOUNDED PRECEDING) AS active
    FROM ports_event
),
ports_bucket AS (
    SELECT date_trunc('{unit}', ts) AS bucket,
           MAX(active)              AS peak,
           -- The running total at the bucket's last event: what an immediately
           -- following empty bucket should carry forward.
           arg_max(active, ts)      AS closing
    FROM ports_running
    GROUP BY 1
),
ports_grid AS (
    SELECT UNNEST(generate_series((SELECT MIN(bucket) FROM ports_bucket),
                                  (SELECT MAX(bucket) FROM ports_bucket),
                                  INTERVAL 1 {unit})) AS bucket
)"""


def _slice_cte(f: CdrFilter, joined: bool, sweep: bool, unit: str) -> tuple[str, WhereClause, int]:
    """
    The `WITH slice AS MATERIALIZED (...)` header, its WHERE, and day count.

    The sweep CTEs are appended only when a peak-ports panel was asked for —
    they double the row count before aggregating, which is not worth paying for
    on a request that never reads them.
    """
    from_clause, day_count = _from_clause(f, joined)
    where = build_where(f)

    cte = f"""WITH slice AS MATERIALIZED (
    SELECT {_SLICE_COLUMNS}
    {from_clause}
    {where.sql}
)"""
    if sweep:
        cte += _SWEEP_CTES.format(unit=unit)
    return cte, where, day_count


# ── Panel SQL ──────────────────────────────────────────────────────────────
# Each branch reports (panel, label, value) so any set of them can be stacked
# into one statement with UNION ALL. Their differing natural shapes — a single
# total, a category count, a time series — all reduce to that triple, and the
# reshaping back into per-panel envelopes happens in Python below.

_PANEL_SQL: dict[str, str] = {
    "summary": """
    SELECT 'summary' AS panel, 'total_calls' AS label, CAST(COUNT(*) AS DOUBLE) AS value
    FROM slice
    UNION ALL
    -- How many distinct numbers the slice touched, connected or not — one
    -- subscriber reached on four reblasts is one number, not four attempts.
    -- Blanks are excluded rather than counted as a number of their own: a
    -- missing TEL_DIGIT/CLI reads as '' after the cast, not as NULL.
    SELECT 'summary', 'total_phone_numbers',
           CAST(COUNT(DISTINCT PHONE_NUMBER)
                FILTER (WHERE PHONE_NUMBER IS NOT NULL
                          AND TRIM(PHONE_NUMBER) <> '') AS DOUBLE)
    FROM slice
    UNION ALL
    SELECT 'summary', 'minutes_usage',
           CAST(COALESCE(CEIL(SUM(CONNECTED_SECONDS) / 60.0), 0) AS DOUBLE)
    FROM slice
    UNION ALL
    -- Per Business_Rule.md, CRN + CONF_NUM together uniquely identify one
    -- conference/multicall room — CRN alone is reused across bookings. Only
    -- meaningful once the service is scoped to Conference or Multicall; on
    -- All or Voicedrop it's still computed (this is one pass regardless) but
    -- the frontend leaves it off those two KPI rows.
    SELECT 'summary', 'total_conferences',
           CAST(COUNT(DISTINCT (CRN, CONF_NUM)) AS DOUBLE)
    FROM slice""",
    "dtmf": """
    SELECT 'dtmf' AS panel, 'dtmf_count' AS label, CAST(COUNT(*) AS DOUBLE) AS value
    FROM slice
    WHERE DTMFDIGITS IS NOT NULL AND TRIM(DTMFDIGITS) <> ''""",
    # Per the data dictionary CALLTYPE is 1 = dial in, 0 = dial out.
    "call_direction": """
    SELECT 'call_direction' AS panel,
           CASE CALLTYPE WHEN 0 THEN 'Dial In' WHEN 1 THEN 'Dial Out'
                         ELSE 'Unknown' END AS label,
           CAST(COUNT(*) AS DOUBLE) AS value
    FROM slice GROUP BY 2""",
    "connection_status": """
    SELECT 'connection_status' AS panel,
           CASE WHEN IS_CONNECTED THEN 'Connected' ELSE 'Not Connected' END AS label,
           CAST(COUNT(*) AS DOUBLE) AS value
    FROM slice GROUP BY 2""",
    "service_provider": """
    SELECT 'service_provider' AS panel,
           CAST(SERVICE_PROVIDER AS VARCHAR) AS label,
           CAST(COUNT(*) AS DOUBLE) AS value
    FROM slice GROUP BY 2""",
    # LOCATION_ID names the bridge server (data dictionary #4). Shown as
    # "L<id>" rather than the bare number, since that's how the bridges are
    # referred to operationally.
    "location": """
    SELECT 'location' AS panel,
           'L' || CAST(LOCATION_ID AS VARCHAR) AS label,
           CAST(COUNT(*) AS DOUBLE) AS value
    FROM slice GROUP BY 2""",
    # Billable seconds (see CONNECTED_SECONDS above), by location and by dial
    # direction within it — the Minutes Usage KPI's hover. Left in raw seconds
    # here; _split_minutes_by_location converts to minutes per line so the
    # location total and its two direction lines are each rounded up on their
    # own terms, the same way the top-line minutes_usage figure is.
    "minutes_by_location": """
    SELECT 'minutes_by_location' AS panel,
           'L' || CAST(LOCATION_ID AS VARCHAR) || '::' ||
           CASE CALLTYPE WHEN 0 THEN 'Dial In' WHEN 1 THEN 'Dial Out' ELSE 'Unknown' END AS label,
           CAST(COALESCE(SUM(CONNECTED_SECONDS), 0) AS DOUBLE) AS value
    FROM slice GROUP BY 2""",
    # The call lifecycle for dial-out (Voicedrop) rows, one count per stage:
    # blasted, rang, connected, ended. Each is independent — a row not counted
    # at one stage can still be counted at a later one (an unanswered blast
    # still carries a disconnect) — so this is not a strict funnel where every
    # stage is a subset of the last.
    "call_funnel": """
    SELECT 'call_funnel' AS panel, 'Call Initiated' AS label,
           CAST(COUNT(*) FILTER (WHERE PROCEEDING IS NOT NULL) AS DOUBLE) AS value
    FROM slice
    UNION ALL
    SELECT 'call_funnel', 'Call Ringed',
           CAST(COUNT(*) FILTER (WHERE ALERT IS NOT NULL) AS DOUBLE)
    FROM slice
    UNION ALL
    SELECT 'call_funnel', 'Call Connected',
           CAST(COUNT(*) FILTER (WHERE IS_CONNECTED) AS DOUBLE)
    FROM slice
    UNION ALL
    SELECT 'call_funnel', 'Call Ended',
           CAST(COUNT(*) FILTER (WHERE DISCONNECT_DATETIME IS NOT NULL) AS DOUBLE)
    FROM slice""",
    # Same four stages, each split Dial In / Dial Out. Initiated and Ringed
    # come from PROCEEDING/ALERT, which the data dictionary documents as
    # dial-out-only fields, so those two stages should read as nearly all
    # Dial Out — that's the real signal, not a bug in the split.
    "call_funnel_direction": _direction_split_sql(
        "call_funnel_direction",
        [
            ("Call Initiated", "PROCEEDING IS NOT NULL"),
            ("Call Ringed", "ALERT IS NOT NULL"),
            ("Call Connected", "IS_CONNECTED"),
            ("Call Ended", "DISCONNECT_DATETIME IS NOT NULL"),
        ],
    ),
    # Connected-call duration in seconds, bucketed. Only connected calls have
    # a meaningful duration — an unconnected row's CONNECTED_SECONDS is 0,
    # which would otherwise pad the 0-10 bucket with calls that never happened.
    "call_duration": """
    SELECT 'call_duration' AS panel, '0-10' AS label,
           CAST(COUNT(*) FILTER (WHERE IS_CONNECTED AND CONNECTED_SECONDS <= 10) AS DOUBLE) AS value
    FROM slice
    UNION ALL
    SELECT 'call_duration', '11-30',
           CAST(COUNT(*) FILTER (WHERE IS_CONNECTED AND CONNECTED_SECONDS > 10
                                        AND CONNECTED_SECONDS <= 30) AS DOUBLE)
    FROM slice
    UNION ALL
    SELECT 'call_duration', '31-60',
           CAST(COUNT(*) FILTER (WHERE IS_CONNECTED AND CONNECTED_SECONDS > 30
                                        AND CONNECTED_SECONDS <= 60) AS DOUBLE)
    FROM slice
    UNION ALL
    SELECT 'call_duration', '60+',
           CAST(COUNT(*) FILTER (WHERE IS_CONNECTED AND CONNECTED_SECONDS > 60) AS DOUBLE)
    FROM slice""",
    "call_duration_direction": _direction_split_sql(
        "call_duration_direction",
        [
            ("0-10", "IS_CONNECTED AND CONNECTED_SECONDS <= 10"),
            ("11-30", "IS_CONNECTED AND CONNECTED_SECONDS > 10 AND CONNECTED_SECONDS <= 30"),
            ("31-60", "IS_CONNECTED AND CONNECTED_SECONDS > 30 AND CONNECTED_SECONDS <= 60"),
            ("60+", "IS_CONNECTED AND CONNECTED_SECONDS > 60"),
        ],
    ),
    # Which blast a conferee's number went out on. CONFDIAL_REBLAST_COUNT is
    # the only column that carries this: the data dictionary defines it as
    # "at which blast the Conferee's number is dialled out", while
    # REBLAST_COUNT and DIALLIST_REBLAST_COUNT are both documented as unused
    # and measure that way in the exports too — REBLAST_COUNT is 0 on every
    # row, DIALLIST_REBLAST_COUNT only ever 0 or the sentinel 255.
    #
    # Blast 0 (the initial dial) is charted rather than filtered out: it is
    # the largest group, and the AID_COUNT breakdown behind it is exactly what
    # the hover exists to show.
    "reblast": """
    SELECT 'reblast' AS panel,
           'Blast ' || CAST(CONFDIAL_REBLAST_COUNT AS VARCHAR) AS label,
           CAST(COUNT(*) AS DOUBLE) AS value
    FROM slice GROUP BY 2""",
    # How each blast splits across AID_COUNT (0 initial, 1-3 successive retry
    # attempts), and each of those again by connection status. Encoded as
    # "Blast N::AID M::Connected|Not Connected" and unpacked in _shape — the
    # same trick the direction-split panels use, so this still stacks into the
    # one dashboard statement instead of costing its own read of the range.
    "reblast_aid": """
    SELECT 'reblast_aid' AS panel,
           'Blast ' || CAST(CONFDIAL_REBLAST_COUNT AS VARCHAR)
                    || '::AID ' || CAST(AID_COUNT AS VARCHAR)
                    || '::' || CASE WHEN IS_CONNECTED THEN 'Connected' ELSE 'Not Connected' END AS label,
           CAST(COUNT(*) AS DOUBLE) AS value
    FROM slice GROUP BY 2""",
    # Grouped as the raw numeric code; the code -> label mapping is applied in
    # Python from disconnect_reasons.json so new codes need no SQL change.
    "disconnect_reason": """
    SELECT 'disconnect_reason' AS panel,
           CAST(DISCONNECT_REASON AS VARCHAR) AS label,
           CAST(COUNT(*) AS DOUBLE) AS value
    FROM slice GROUP BY 2""",
    # Highest concurrency reached in each bucket, off the sweep defined above.
    # Every bucket in the span is reported, including the ones no call started
    # in — those carry the previous bucket's closing occupancy.
    "peak_ports": """
    SELECT 'peak_ports' AS panel,
           strftime(g.bucket, '{fmt}') AS label,
           CAST(COALESCE(b.peak,
                         last_value(b.closing IGNORE NULLS) OVER (ORDER BY g.bucket))
                AS DOUBLE) AS value
    FROM ports_grid g
    LEFT JOIN ports_bucket b ON b.bucket = g.bucket""",
}


def compute_panels(
    f: CdrFilter, panels: Iterable[str] = DASHBOARD_PANELS
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, Any]]:
    """
    Run the requested panels in a single pass over the range.

    Returns the panel rows keyed by panel name, plus the coverage/filter
    metadata describing what was read.
    """
    wanted = [p for p in panels if p in _PANEL_SQL]
    if not wanted:
        raise ValueError(f"No known panels requested. Known: {', '.join(_PANEL_SQL)}.")

    joined = needs_codr(f)
    unit = _bucket_unit(f.span_days)
    sweep = "peak_ports" in wanted
    cte, where, day_count = _slice_cte(f, joined, sweep, unit)

    branches = [
        _PANEL_SQL[p].format(unit=unit, fmt=_BUCKET_FORMAT[unit])
        if p == "peak_ports"
        else _PANEL_SQL[p]
        for p in wanted
    ]

    rows = _run(cte + "\n" + "\nUNION ALL".join(branches), where.params)

    grouped: dict[str, list[dict[str, Any]]] = {p: [] for p in wanted}
    for row in rows:
        grouped[row["panel"]].append({"label": row["label"], "value": row["value"] or 0})

    meta = {
        "filters_applied": _applied(f, where, joined),
        "coverage": {
            "days_requested": f.span_days,
            "days_matched": day_count,
            "first_day": f.date_from.isoformat(),
            "last_day": f.date_to.isoformat(),
            "bucket": unit,
        },
    }
    return grouped, meta


# ── Reshaping ──────────────────────────────────────────────────────────────
# The triple shape is a transport detail. These put each panel back into the
# form its endpoint documents.


def _by_value(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda r: r["value"], reverse=True)


def _by_label(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda r: r["label"])


def _scalar(rows: list[dict[str, Any]], label: str) -> float:
    for row in rows:
        if row["label"] == label:
            return row["value"]
    return 0


def _map_disconnect_reasons(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fold raw codes onto their labels; an unmapped code becomes "Unknown"."""
    totals: dict[str, float] = {}
    for row in rows:
        reason = _DISCONNECT_REASONS.get(str(row["label"]), "Unknown")
        totals[reason] = totals.get(reason, 0) + row["value"]
    return _by_value([{"label": r, "value": v} for r, v in totals.items()])


def _trailing_int(label: str) -> int:
    """The number off the end of "Blast 12" / "AID 3", for numeric ordering.

    Sorting these lexicographically would read Blast 1, Blast 10, Blast 11,
    Blast 2 — the labels are text, but the axis they describe is a sequence.
    """
    try:
        return int(label.rsplit(" ", 1)[1])
    except (IndexError, ValueError):
        return 10**6


def _split_reblast_aid(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Decode "Blast N::AID M::Connected|Not Connected" into a Blast -> AID -> connection-status tree."""
    grouped: dict[str, dict[str, dict[str, float]]] = {}
    for row in rows:
        blast, _, rest = row["label"].partition("::")
        aid, _, status = rest.partition("::")
        bucket = grouped.setdefault(blast, {}).setdefault(aid, {"Connected": 0.0, "Not Connected": 0.0})
        if status in bucket:
            bucket[status] = row["value"]

    return [
        {
            "label": blast,
            "aid": [
                {
                    "label": aid,
                    "connected": int(counts["Connected"]),
                    "not_connected": int(counts["Not Connected"]),
                }
                for aid, counts in sorted(aids.items(), key=lambda kv: _trailing_int(kv[0]))
            ],
        }
        for blast, aids in sorted(grouped.items(), key=lambda kv: _trailing_int(kv[0]))
    ]


def _ceil_minutes(seconds: float) -> int:
    """Whole seconds rounded up to the next minute — matches the top-line minutes_usage formula, per line."""
    return -(-int(seconds) // 60) if seconds > 0 else 0


def _split_minutes_by_location(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Decode "L<n>::Dial In|Dial Out" seconds into {label, minutes, dial_in, dial_out}, busiest location first."""
    grouped: dict[str, dict[str, float]] = {}
    for row in rows:
        location, _, direction = row["label"].partition("::")
        bucket = grouped.setdefault(location, {"Dial In": 0.0, "Dial Out": 0.0})
        if direction in bucket:
            bucket[direction] = row["value"]

    ranked = sorted(grouped.items(), key=lambda kv: kv[1]["Dial In"] + kv[1]["Dial Out"], reverse=True)
    return [
        {
            "label": location,
            "minutes": _ceil_minutes(vals["Dial In"] + vals["Dial Out"]),
            "dial_in": _ceil_minutes(vals["Dial In"]),
            "dial_out": _ceil_minutes(vals["Dial Out"]),
        }
        for location, vals in ranked
    ]


def _split_by_direction(rows: list[dict[str, Any]], order: dict[str, int]) -> list[dict[str, Any]]:
    """Decode "<stage>::<direction>" labels from _direction_split_sql back into {label, dial_in, dial_out}."""
    grouped: dict[str, dict[str, float]] = {}
    for row in rows:
        stage, _, direction = row["label"].partition("::")
        bucket = grouped.setdefault(stage, {"Dial In": 0.0, "Dial Out": 0.0})
        if direction in bucket:
            bucket[direction] = row["value"]
    return [
        {"label": stage, "dial_in": int(vals["Dial In"]), "dial_out": int(vals["Dial Out"])}
        for stage, vals in sorted(grouped.items(), key=lambda kv: order.get(kv[0], 99))
    ]


def _shape(panel: str, rows: list[dict[str, Any]]) -> Any:
    """One panel's rows in the form its endpoint documents."""
    if panel == "summary":
        return {
            "total_calls": int(_scalar(rows, "total_calls")),
            "total_phone_numbers": int(_scalar(rows, "total_phone_numbers")),
            "minutes_usage": int(_scalar(rows, "minutes_usage")),
            "total_conferences": int(_scalar(rows, "total_conferences")),
        }
    if panel == "dtmf":
        return int(_scalar(rows, "dtmf_count"))
    if panel == "peak_ports":
        return [{"bucket": r["label"], "peak": r["value"]} for r in _by_label(rows)]
    if panel == "reblast":
        stages = sorted(rows, key=lambda r: _trailing_int(r["label"]))
        # The headline figure reads as "how many were actually reblasted", so
        # Blast 0 — the initial dial — is left out of it even though it is
        # charted alongside the rest.
        total = sum(r["value"] for r in stages if _trailing_int(r["label"]) > 0)
        return {"total": total, "stages": stages}
    if panel == "reblast_aid":
        return _split_reblast_aid(rows)
    if panel == "minutes_by_location":
        return _split_minutes_by_location(rows)
    if panel == "disconnect_reason":
        return _map_disconnect_reasons(rows)
    if panel == "call_funnel":
        # Stage order, not value order — sorting by count would scramble the
        # lifecycle sequence the chart is meant to read left to right.
        return sorted(rows, key=lambda r: _FUNNEL_STAGE_ORDER[r["label"]])
    if panel == "call_duration":
        return sorted(rows, key=lambda r: _DURATION_BUCKET_ORDER[r["label"]])
    if panel == "call_funnel_direction":
        return _split_by_direction(rows, _FUNNEL_STAGE_ORDER)
    if panel == "call_duration_direction":
        return _split_by_direction(rows, _DURATION_BUCKET_ORDER)
    return _by_value(rows)


def query_dashboard(f: CdrFilter) -> dict:
    """Every dashboard panel, from one pass over the range."""
    grouped, meta = compute_panels(f)
    return {panel: _shape(panel, rows) for panel, rows in grouped.items()} | meta


# ── Single-panel endpoints ─────────────────────────────────────────────────
# Same SQL, one panel at a time, in the shared {rows, row_count, ...} envelope.
# The dashboard uses query_dashboard instead so the files are read once.


# The dimension name each categorical endpoint documents for its label column.
_LABEL_KEY = {
    "call_direction": "direction",
    "connection_status": "connection_status",
    "service_provider": "service_provider",
    "disconnect_reason": "reason",
    "location": "location",
    "call_funnel": "stage",
    "call_duration": "duration_bucket",
}


def query_panel(f: CdrFilter, panel: str) -> dict:
    """One panel, in the shared envelope."""
    grouped, meta = compute_panels(f, [panel])
    shaped = _shape(panel, grouped[panel])

    # The scalar panels have no natural row list, so they answer as the single
    # row the envelope expects.
    if panel == "summary":
        rows = [shaped]
    elif panel == "dtmf":
        rows = [{"dtmf_count": shaped}]
    elif panel == "reblast":
        rows = [{"blast": r["label"], "count": r["value"]} for r in shaped["stages"]]
    elif panel in (
        "peak_ports",
        "call_funnel_direction",
        "call_duration_direction",
        "reblast_aid",
        "minutes_by_location",
    ):
        rows = shaped
    else:
        rows = [{_LABEL_KEY[panel]: r["label"], "count": r["value"]} for r in shaped]

    return {"rows": rows, "row_count": len(rows), **meta}


# ── Queries with their own shape ───────────────────────────────────────────
# These don't reduce to (panel, label, value), so they run their own statement.


def query_records(req: CdrRecordsRequest) -> dict:
    """Raw rows for the range, newest first, paginated."""
    joined = needs_codr(req)
    from_clause, day_count = _from_clause(req, joined)
    where = build_where(req)

    settings = get_settings()
    page_size = min(req.page_size, settings.CDR_MAX_ROWS_PER_QUERY)
    offset = (req.page - 1) * page_size

    total = _run(f"SELECT COUNT(*) AS n {from_clause} {where.sql}", where.params)[0]["n"]

    # c.* keeps the answer to the CDR columns the caller asked about — the join,
    # when present, is there to filter, not to widen the row.
    rows = _run(
        f"SELECT c.* {from_clause} {where.sql} "
        "ORDER BY c.START_DATETIME DESC LIMIT ? OFFSET ?",
        [*where.params, page_size, offset],
    )

    return {
        "rows": rows,
        "row_count": len(rows),
        "filters_applied": _applied(req, where, joined),
        "truncated": req.page_size > page_size,
        "page": req.page,
        "page_size": page_size,
        "total": total,
        "total_pages": (total + page_size - 1) // page_size if total else 0,
        "coverage": {
            "days_requested": req.span_days,
            "days_matched": day_count,
            "first_day": req.date_from.isoformat(),
            "last_day": req.date_to.isoformat(),
        },
    }


def query_by_date(f: CdrFilter) -> dict:
    """Daily breakdown, oldest first."""
    joined = needs_codr(f)
    from_clause, _ = _from_clause(f, joined)
    where = build_where(f)
    limit = get_settings().CDR_MAX_ROWS_PER_QUERY

    rows = _run(
        f"""
        SELECT COALESCE(c.CALL_DATE, CAST(c.START_DATETIME AS DATE)) AS call_date,
               COUNT(*)                                              AS total_rows,
               COUNT(*) FILTER (WHERE c.INCONF_DATETIME_EPOC <> 0)    AS connected_rows,
               COUNT(DISTINCT c.CRN)                                  AS distinct_crns,
               COUNT(DISTINCT c.ACCOUNTID)                            AS distinct_accounts
        {from_clause}
        {where.sql}
        GROUP BY 1
        ORDER BY 1
        LIMIT ?
        """,
        [*where.params, limit],
    )
    return {
        "rows": rows,
        "row_count": len(rows),
        "filters_applied": _applied(f, where, joined),
        "truncated": len(rows) == limit,
    }


def query_by_account(f: CdrFilter) -> dict:
    """
    Per-account, per-service breakdown, busiest first.

    This is the one breakdown that reports SERVICE_TYPE as a column, so it
    always joins CODR — without MODULE_TYPE it could not tell a multicall from
    a conference.
    """
    from_clause, _ = _from_clause(f, joined=True)
    where = build_where(f)
    limit = get_settings().CDR_MAX_ROWS_PER_QUERY

    rows = _run(
        f"""
        SELECT c.ACCOUNTID                                            AS account_id,
               {SERVICE_TYPE_EXPR}                                    AS service_type,
               COUNT(*)                                               AS total_rows,
               COUNT(*) FILTER (WHERE c.INCONF_DATETIME_EPOC <> 0)     AS connected_rows,
               COUNT(DISTINCT c.CRN)                                  AS distinct_crns,
               MIN(COALESCE(c.CALL_DATE, CAST(c.START_DATETIME AS DATE))) AS first_date,
               MAX(COALESCE(c.CALL_DATE, CAST(c.START_DATETIME AS DATE))) AS last_date
        {from_clause}
        {where.sql}
        GROUP BY 1, 2
        ORDER BY total_rows DESC
        LIMIT ?
        """,
        [*where.params, limit],
    )
    return {
        "rows": rows,
        "row_count": len(rows),
        "filters_applied": _applied(f, where, joined=True),
        "truncated": len(rows) == limit,
    }


def query_call_cube(f: CdrFilter) -> dict:
    """
    One row per (location, connected, direction, provider) combination, each
    with its count — what the Blast Details charts cross-reference so hovering
    a bar can show its connected/not-connected, dial-in/out, location and
    provider breakdown instead of just its own total.

    Standalone rather than a `slice`-CTE panel: nothing else needs all four
    dimensions joined together, so there's no shared query to slot into.
    """
    joined = needs_codr(f)
    from_clause, day_count = _from_clause(f, joined)
    where = build_where(f)

    rows = _run(
        f"""
        SELECT 'L' || CAST(c.LOCATION_ID AS VARCHAR)                          AS location,
               (c.INCONF_DATETIME_EPOC IS NOT NULL AND c.INCONF_DATETIME_EPOC <> 0)
                                                                                AS is_connected,
               {_CALL_DIRECTION_EXPR}                                         AS call_direction,
               CAST(c.SERVICE_PROVIDER AS VARCHAR)                            AS service_provider,
               CAST(COUNT(*) AS BIGINT)                                       AS count
        {from_clause}
        {where.sql}
        GROUP BY 1, 2, 3, 4
        """,
        where.params,
    )
    return {
        "rows": rows,
        "total_calls": sum(r["count"] for r in rows),
        "coverage": {
            "days_requested": f.span_days,
            "days_matched": day_count,
            "first_day": f.date_from.isoformat(),
            "last_day": f.date_to.isoformat(),
        },
    }


# ── Status ─────────────────────────────────────────────────────────────────


def lake_status() -> dict:
    """What the configured directories hold, plus the day to open on."""
    status = lake.coverage()
    default = lake.default_day()
    status["default_date"] = default.isoformat() if default else None
    return status
