"""
Campaign Metrics — account / service-provider / location breakdowns for a
single day.

A separate module from cdr/service.py by design: this feature was asked for
as its own backend endpoints that don't touch the existing CDR dashboard
query paths at all. It shares only app/cdr/lake.py (read-only file discovery,
unmodified) — the WHERE clause and slice below are written fresh rather than
importing app/cdr/filters.py's CdrFilter-shaped helpers, since CampaignFilter
carries a single `date`, not a `date_from`/`date_to` range.

Every breakdown answers the same two questions, straight from the reference
SQL this module was built against:

    Total size     = COUNT(DISTINCT CONFEREE_SEQ_NO) for the scope
    Connected size = COUNT(DISTINCT CONFEREE_SEQ_NO) FILTER (WHERE the
                     conferee actually joined — INCONFERENCE IS NOT NULL)

Not-connected is total minus connected rather than its own DISTINCT COUNT: a
connected conferee's rows are always a subset of that scope's rows, so the
subtraction is exact and can never go negative.
"""

import logging
from decimal import Decimal
from typing import Any

import duckdb

from app.cdr import lake
from app.schemas.campaign import CampaignFilter

logger = logging.getLogger(__name__)

# Same service predicates as app/cdr/filters.py::_SERVICE_PREDICATES, kept as
# a small local copy rather than imported — CampaignFilter doesn't carry the
# cpin/account_id/crn fields that module's needs_codr()/build_where() read,
# so reusing it directly would mean bolting those fields on for no reason.
# Must stay in sync with filters.py if the CDR data dictionary's service
# classification ever changes.
_SERVICE_JOIN: dict[str, bool] = {"voicedrop": False, "conference": True, "multicall": True}
_SERVICE_PREDICATE: dict[str, str] = {
    "voicedrop": "c.CONFEREE_TYPE = 6",
    "conference": "o.MODULE_TYPE = 1",
    "multicall": "o.MODULE_TYPE = 4",
}


class DatasetNotReady(RuntimeError):
    """The lake can't answer: directory unreachable, or no file for this day."""


def _sql_list(paths) -> str:
    return "[" + ", ".join("'" + str(p).replace("'", "''") + "'" for p in paths) + "]"


def _from_clause(f: CampaignFilter) -> str:
    """The FROM (and LEFT JOIN, for Conference/Multicall) for this one day."""
    try:
        cdr_files = lake.files_for_range("cdr", f.date, f.date)
    except lake.LakeUnavailable as exc:
        raise DatasetNotReady(str(exc)) from exc
    if not cdr_files:
        raise DatasetNotReady(f"No CDR export file for {f.date} in {lake.root('cdr')}.")

    clause = f"FROM read_parquet({_sql_list(cdr_files)}) c"

    if _SERVICE_JOIN[f.service]:
        try:
            codr_files = lake.files_for_range("codr", f.date, f.date)
        except lake.LakeUnavailable as exc:
            raise DatasetNotReady(str(exc)) from exc
        if not codr_files:
            raise DatasetNotReady(
                f"{f.service.capitalize()} needs CODR, but there is no CODR export "
                f"file for {f.date} in {lake.root('codr')}."
            )
        # CRN alone is reused across rooms; CONF_NUM makes the pair unique, so
        # this matches at most one CODR record per CDR row and cannot fan out.
        clause += (
            f"\n    LEFT JOIN read_parquet({_sql_list(codr_files)}) o"
            "\n           ON o.CRN = c.CRN AND o.CONF_NUM = c.CONF_NUM"
        )

    return clause


def _where(f: CampaignFilter) -> tuple[str, list[Any]]:
    predicate = _SERVICE_PREDICATE[f.service]
    return (
        f"WHERE {predicate} AND COALESCE(c.CALL_DATE, CAST(c.START_DATETIME AS DATE)) = ?",
        [f.date],
    )


def _jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    return value


def _run(sql: str, params: list[Any]) -> list[dict[str, Any]]:
    try:
        with duckdb.connect() as con:
            cursor = con.execute(sql, params)
            columns = [d[0] for d in cursor.description]
            return [
                {col: _jsonable(val) for col, val in zip(columns, row)}
                for row in cursor.fetchall()
            ]
    except duckdb.Error as exc:
        logger.error(f"Campaign metrics query failed: {exc}")
        raise DatasetNotReady(f"Query failed against the lake: {exc}") from exc


# The aggregate figures every breakdown below groups the same way — only the
# SELECT's grouping dimension changes between account/provider/location.
#
# The distinct key is (CRN, CONFEREE_SEQ_NO), not CONFEREE_SEQ_NO alone. Per the
# data dictionary the sequence number is "unique for each conferee" *within a
# CRN*, so counting it bare across a group spanning several CRNs silently merges
# two different people who happen to share a number. Measured on 2026-08-17,
# account 109775: 17,073 bare vs 17,106 keyed — the latter being exactly the sum
# of that account's four CRN rows, which is what the expanded table has to add up
# to.
#
# Billable seconds mirror cdr/service.py's CONNECTED_SECONDS: joining-to-release,
# and only for conferees who actually joined.
_METRIC_COLUMNS = """
       COUNT(DISTINCT (c.CRN, c.CONFEREE_SEQ_NO))                                 AS total_size,
       COUNT(DISTINCT (c.CRN, c.CONFEREE_SEQ_NO))
           FILTER (WHERE c.INCONFERENCE IS NOT NULL)                              AS connected_size,
       CAST(COALESCE(CEIL(SUM(
           CASE WHEN c.INCONFERENCE IS NOT NULL
                THEN c.RELEASE_DATETIME_EPOC - c.INCONF_DATETIME_EPOC
                ELSE 0 END
       ) / 60.0), 0) AS DOUBLE)                                                   AS total_minutes"""


def _with_derived(row: dict[str, Any]) -> dict[str, Any]:
    """Fill in not_connected_size and connected_percentage from the two raw counts."""
    total = int(row.get("total_size") or 0)
    connected = int(row.get("connected_size") or 0)
    row["total_size"] = total
    row["connected_size"] = connected
    row["not_connected_size"] = total - connected
    row["connected_percentage"] = round((connected / total) * 100, 1) if total else 0.0
    if "total_minutes" in row:
        row["total_minutes"] = int(row["total_minutes"] or 0)
    return row


def query_account_wise(f: CampaignFilter) -> list[dict[str, Any]]:
    """
    Per-account breakdown for the day — the Account Wise table's top-level rows.

    Aggregated per CRN first, then summed, so an account row is exactly the sum
    of the CRN rows it expands into — every column, minutes included. Rolling
    the account up directly instead would make minutes CEIL(SUM(...)) where the
    children are SUM(CEIL(...)), and the expanded rows would visibly fail to add
    up to the row above them.
    """
    from_clause = _from_clause(f)
    where_sql, params = _where(f)

    rows = _run(
        f"""
        WITH per_crn AS (
            SELECT CAST(c.ACCOUNTID AS VARCHAR) AS account,
                   c.CRN                        AS crn,
                   {_METRIC_COLUMNS}
            {from_clause}
            {where_sql}
            GROUP BY 1, 2
        )
        SELECT account,
               SUM(total_size)     AS total_size,
               SUM(connected_size) AS connected_size,
               SUM(total_minutes)  AS total_minutes
        FROM per_crn
        GROUP BY 1
        ORDER BY total_size DESC
        """,
        params,
    )
    return [_with_derived(r) for r in rows]


def query_account_crn(f: CampaignFilter, account_id: str) -> list[dict[str, Any]]:
    """CRN breakdown within one account — the Account Wise table's expand-row drill-down."""
    from_clause = _from_clause(f)
    where_sql, params = _where(f)

    rows = _run(
        f"""
        SELECT CAST(c.CRN AS VARCHAR) AS crn,
               {_METRIC_COLUMNS}
        {from_clause}
        {where_sql} AND CAST(c.ACCOUNTID AS VARCHAR) = ?
        GROUP BY 1
        ORDER BY total_size DESC
        """,
        [*params, account_id],
    )
    return [_with_derived(r) for r in rows]


def query_service_provider_wise(f: CampaignFilter) -> list[dict[str, Any]]:
    """Per-service-provider breakdown for the day."""
    from_clause = _from_clause(f)
    where_sql, params = _where(f)

    rows = _run(
        f"""
        SELECT CAST(c.SERVICE_PROVIDER AS VARCHAR) AS service_provider,
               {_METRIC_COLUMNS}
        {from_clause}
        {where_sql}
        GROUP BY 1
        ORDER BY total_size DESC
        """,
        params,
    )
    return [_with_derived(r) for r in rows]


def query_location_wise(f: CampaignFilter) -> list[dict[str, Any]]:
    """Per-location (bridge server) breakdown for the day."""
    from_clause = _from_clause(f)
    where_sql, params = _where(f)

    rows = _run(
        f"""
        SELECT 'L' || CAST(c.LOCATION_ID AS VARCHAR) AS location,
               {_METRIC_COLUMNS}
        {from_clause}
        {where_sql}
        GROUP BY 1
        ORDER BY total_size DESC
        """,
        params,
    )
    return [_with_derived(r) for r in rows]


# ── Account insight (the per-row chart popup) ──────────────────────────────
# Its own endpoint, requested only when a row's chart icon is actually clicked,
# so the table itself never pays for these aggregates.
#
# Every figure below is validated against 2026-08-17 / account 109775:
#   uploaded 17,073 · attempts 45,499 · connected users 9,356
#   failed attempts 35,889 = 13,606 never-rang + 22,283 rang-unanswered
#   = attempts (45,499) - connected attempts (9,610) exactly.
#
# "Connected" is INCONFERENCE IS NOT NULL throughout — the data dictionary's
# note on field 15 makes INCONFERENCE the timestamp that decides whether a
# person actually joined. Its epoch twin INCONF_DATETIME_EPOC > 0 agrees on
# every row measured (56,593 voicedrop rows on 2026-08-17, zero disagreements),
# so this is the same population expressed against the documented column.
#
# One statement, panel-encoded as (panel, label, value) triples and unpacked in
# Python, so the popup costs a single read of the day's file rather than five.
_INSIGHT_SQL = """
    SELECT 'summary' AS panel, 'total_uploaded' AS label,
           CAST(COUNT(DISTINCT (CRN, CONFEREE_SEQ_NO)) AS DOUBLE) AS value
    FROM slice
    UNION ALL
    SELECT 'summary', 'dial_attempts', CAST(COUNT(*) AS DOUBLE) FROM slice
    UNION ALL
    SELECT 'summary', 'connected_users',
           CAST(COUNT(DISTINCT (CRN, CONFEREE_SEQ_NO)) FILTER (WHERE CONNECTED) AS DOUBLE)
    FROM slice
    UNION ALL
    -- Connected users split by how the leg was established. These are counted
    -- independently, so a conferee with both a connected dial-in and a
    -- connected dial-out leg lands in both and the two need not sum to
    -- connected_users — which is why the popup prints them as a breakdown
    -- beside the headline rather than as a partition of it.
    SELECT 'summary', 'connected_dial_out',
           CAST(COUNT(DISTINCT (CRN, CONFEREE_SEQ_NO))
                FILTER (WHERE CONNECTED AND IS_DIAL_OUT) AS DOUBLE)
    FROM slice
    UNION ALL
    SELECT 'summary', 'connected_dial_in',
           CAST(COUNT(DISTINCT (CRN, CONFEREE_SEQ_NO))
                FILTER (WHERE CONNECTED AND NOT IS_DIAL_OUT) AS DOUBLE)
    FROM slice
    UNION ALL
    -- Failure split. ALERT is the ring timestamp (data dictionary #13), so a
    -- failed attempt with no ALERT never rang at all, and one with an ALERT
    -- rang but went unanswered. The two are exhaustive over failures.
    SELECT 'failed', 'never_rang',
           CAST(COUNT(*) FILTER (WHERE NOT CONNECTED AND ALERT IS NULL) AS DOUBLE)
    FROM slice
    UNION ALL
    SELECT 'failed', 'rang_unanswered',
           CAST(COUNT(*) FILTER (WHERE NOT CONNECTED AND ALERT IS NOT NULL) AS DOUBLE)
    FROM slice
    UNION ALL
    -- Disconnect reasons, over failed attempts only — the mockup's
    -- "share of all failures".
    SELECT 'disconnect', CAST(DISCONNECT_REASON AS VARCHAR),
           CAST(COUNT(*) AS DOUBLE)
    FROM slice WHERE NOT CONNECTED GROUP BY 2
    UNION ALL
    -- Per-carrier connect rate, on the same distinct-conferee basis as the
    -- headline Connect % so the two are directly comparable.
    SELECT 'carrier', CAST(SERVICE_PROVIDER AS VARCHAR) || '::total',
           CAST(COUNT(DISTINCT (CRN, CONFEREE_SEQ_NO)) AS DOUBLE)
    FROM slice GROUP BY 2
    UNION ALL
    SELECT 'carrier', CAST(SERVICE_PROVIDER AS VARCHAR) || '::connected',
           CAST(COUNT(DISTINCT (CRN, CONFEREE_SEQ_NO)) FILTER (WHERE CONNECTED) AS DOUBLE)
    FROM slice GROUP BY 2
"""

# Blast x AID grid. CONFDIAL_REBLAST_COUNT is which blast the number went out on
# (data dictionary #26); AID_COUNT is the retry sequence within it (#27).
# total_initiated is the dial-out attempt count for that exact cell — the dotted
# reference line each AID group is drawn against, which is why it sits at or
# above every bar in the group rather than among them.
#
# One branch per metric, same (panel, label, value) triple as everything above,
# so the whole grid still stacks into the single statement.
_BLASTAID_METRICS: list[tuple[str, str]] = [
    ("proceeded", "PROCEEDING IS NOT NULL"),
    ("alert", "ALERT IS NOT NULL"),
    ("connected", "CONNECTED"),
    ("ended", "DISCONNECT_DATETIME IS NOT NULL"),
    ("total_initiated", "TRUE"),
]

# The whole grid is scoped to dial-out rows (WHERE IS_DIAL_OUT below), which is
# what makes total_initiated a true ceiling for the group rather than just
# another bar. Without it the Ended bar outruns the dotted line — measured on
# 2026-08-17/109775, Blast 0 AID 0: 18,011 rows ended but only 17,106 were dial-
# out, so the reference line would have been drawn *under* a bar. Scoping is
# also the honest reading of the panel: PROCEEDING and ALERT are documented as
# dial-out-only fields (#12, #13), so a dial-in row can never register on two of
# these four series anyway.
_INSIGHT_SQL += "".join(
    f"""
    UNION ALL
    SELECT 'blastaid' AS panel,
           'Blast ' || CAST(CONFDIAL_REBLAST_COUNT AS VARCHAR)
                    || '::AID ' || CAST(AID_COUNT AS VARCHAR)
                    || '::{metric}' AS label,
           CAST(COUNT(*) FILTER (WHERE {condition}) AS DOUBLE) AS value
    FROM slice WHERE IS_DIAL_OUT GROUP BY 2"""
    for metric, condition in _BLASTAID_METRICS
)

# How many disconnect reasons are charted individually before the tail is
# folded into "Other" — the mockup shows two named bands plus a remainder.
_TOP_DISCONNECT_REASONS = 2


def query_account_insight(
    f: CampaignFilter, account_id: str, crn: str | None = None
) -> dict[str, Any]:
    """
    The per-row chart popup: headline figures, failure split, disconnect
    reasons, per-carrier connect rate, and the Blast x AID grid.

    Scoped to one account, and optionally one CRN within it, so this stays a
    narrow read even though it computes more than the table does.
    """
    from_clause = _from_clause(f)
    where_sql, params = _where(f)

    where_sql += " AND CAST(c.ACCOUNTID AS VARCHAR) = ?"
    params = [*params, account_id]
    if crn:
        where_sql += " AND CAST(c.CRN AS VARCHAR) = ?"
        params.append(crn)

    cte = f"""WITH slice AS MATERIALIZED (
    SELECT c.CRN,
           c.CONFEREE_SEQ_NO,
           c.SERVICE_PROVIDER,
           c.DISCONNECT_REASON,
           c.DISCONNECT_DATETIME,
           c.PROCEEDING,
           c.ALERT,
           c.CONFDIAL_REBLAST_COUNT,
           c.AID_COUNT,
           (c.INCONFERENCE IS NOT NULL) AS CONNECTED,
           -- CALLTYPE = 1 is Dial Out and 0 is Dial In. This contradicts the
           -- data dictionary's field #5 text ("1-Dial In and 0-Dial Out"), so
           -- it was settled against the columns the dictionary itself marks as
           -- direction-specific. On 2026-08-17's voicedrop rows:
           --
           --   CALLTYPE=1 (55,565): TEL_DIGIT 55,565 · PROCEEDING 55,171 ·
           --                        ALERT 35,104 · CLI 0
           --   CALLTYPE=0  (1,028): TEL_DIGIT 0 · PROCEEDING 0 · ALERT 0 ·
           --                        CLI 1,028 · DID 1,028
           --
           -- TEL_DIGIT is "phone number for Dial Out calls" (#11) and
           -- PROCEEDING/ALERT are "Only for Dial Out calls" (#12, #13); CLI is
           -- "phone number for Dial In calls" (#9). Every one of those lands on
           -- CALLTYPE=1 for outbound and CALLTYPE=0 for inbound, with no
           -- overlap. Voicedrop being an outbound blast agrees. This is also
           -- the mapping cdr/service.py already uses.
           (c.CALLTYPE = 1) AS IS_DIAL_OUT
    {from_clause}
    {where_sql}
)"""

    rows = _run(cte + _INSIGHT_SQL, params)

    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(row["panel"], []).append(
            {"label": row["label"], "value": row["value"] or 0}
        )

    def scalar(panel: str, label: str) -> int:
        for row in grouped.get(panel, []):
            if row["label"] == label:
                return int(row["value"])
        return 0

    uploaded = scalar("summary", "total_uploaded")
    attempts = scalar("summary", "dial_attempts")
    connected_users = scalar("summary", "connected_users")
    never_rang = scalar("failed", "never_rang")
    rang_unanswered = scalar("failed", "rang_unanswered")
    failed_total = never_rang + rang_unanswered

    def pct(part: int, whole: int) -> float:
        return round((part / whole) * 100, 2) if whole else 0.0

    # Disconnect reasons: the largest few by name, the rest as one "Other".
    reasons = sorted(grouped.get("disconnect", []), key=lambda r: r["value"], reverse=True)
    named = reasons[:_TOP_DISCONNECT_REASONS]
    tail = sum(int(r["value"]) for r in reasons[_TOP_DISCONNECT_REASONS:])
    disconnect = [
        {
            "reason": str(r["label"]),
            "count": int(r["value"]),
            "percentage": pct(int(r["value"]), failed_total),
        }
        for r in named
    ]
    if tail:
        disconnect.append(
            {"reason": "Other", "count": tail, "percentage": pct(tail, failed_total)}
        )

    # Carriers: "<provider>::total" / "<provider>::connected" back into one row each.
    carrier_totals: dict[str, dict[str, int]] = {}
    for row in grouped.get("carrier", []):
        provider, _, kind = str(row["label"]).partition("::")
        bucket = carrier_totals.setdefault(provider, {"total": 0, "connected": 0})
        bucket[kind] = int(row["value"])
    carriers = [
        {
            "carrier": provider,
            "total": vals["total"],
            "connected": vals["connected"],
            "connect_percentage": pct(vals["connected"], vals["total"]),
        }
        for provider, vals in sorted(
            carrier_totals.items(), key=lambda kv: kv[1]["total"], reverse=True
        )
    ]

    # Blast x AID: "Blast N::AID M::<metric>" into a blast -> aid -> metrics tree.
    blast_tree: dict[str, dict[str, dict[str, int]]] = {}
    for row in grouped.get("blastaid", []):
        blast, _, rest = str(row["label"]).partition("::")
        aid, _, metric = rest.partition("::")
        blast_tree.setdefault(blast, {}).setdefault(aid, {})[metric] = int(row["value"])

    blasts = [
        {
            "label": blast,
            "aids": [
                {
                    "label": aid,
                    "proceeded": metrics.get("proceeded", 0),
                    "alert": metrics.get("alert", 0),
                    "connected": metrics.get("connected", 0),
                    "ended": metrics.get("ended", 0),
                    "total_initiated": metrics.get("total_initiated", 0),
                }
                for aid, metrics in sorted(aids.items(), key=lambda kv: _trailing_int(kv[0]))
            ],
        }
        for blast, aids in sorted(blast_tree.items(), key=lambda kv: _trailing_int(kv[0]))
    ]

    return {
        "account": account_id,
        "crn": crn,
        "summary": {
            "total_uploaded": uploaded,
            "dial_attempts": attempts,
            "connected_users": connected_users,
            "connected_dial_in": scalar("summary", "connected_dial_in"),
            "connected_dial_out": scalar("summary", "connected_dial_out"),
            "connect_percentage": pct(connected_users, uploaded),
        },
        "failed": {
            "total": failed_total,
            "never_rang": never_rang,
            "rang_unanswered": rang_unanswered,
            "never_rang_percentage": pct(never_rang, failed_total),
            "rang_unanswered_percentage": pct(rang_unanswered, failed_total),
        },
        "disconnect_reasons": disconnect,
        "carriers": carriers,
        "blasts": blasts,
    }


def _trailing_int(label: str) -> int:
    """The number off the end of "Blast 12" / "AID 3", so these sort as the sequence they are."""
    try:
        return int(label.rsplit(" ", 1)[1])
    except (IndexError, ValueError):
        return 10**6
