"""
Port Analyzer — how many ports were in use, moment by moment, for one day.

The logic is the peak-ports sweep the dashboards already use (service.py,
"Peak ports: an interval sweep"): every call is +1 at START_DATETIME and -1
at its release, the running total is the ports in use, and ties put releases
before starts. The release is clamped the same way — a null release makes the
call instantaneous, one stamped before its own start can never retire a port
it never took.

What this adds is the analysis around it:

  * any resolution, from one second to an hour, over any time window of the
    day — and a window never loses the calls already running when it opens:
    the sweep always covers the whole day, so the level carried into the
    window is counted (a filter on start time alone would drop them);
  * a breakdown by service, service provider, account, location or call
    direction — each group swept on its own, the biggest by peak named and
    the rest summed as "Other";
  * who was holding ports at the peak instant;
  * the average concurrency (port-seconds over the window, i.e. Erlangs) and
    the time spent above a capacity line.

Reading a day from the lake is the slow part (seconds, on the share), so the
day's slice — every call of that service that day, with only the columns
used here — is kept in memory for the last few days asked for, and changing
a filter, the window or the breakdown re-runs only the arithmetic on it.

Calls are the ones filed under the day (CALL_DATE). A call still running at
midnight from the day before is not in the day's file, so the first minutes
after midnight can read low.
"""

import logging
import threading
from collections import OrderedDict
from datetime import date, datetime, time, timedelta
from typing import Any, Optional

import duckdb

from app.cdr import directory
from app.cdr.filters import SERVICE_TYPE_EXPR, build_where
from app.cdr.service import DatasetNotReady, _from_clause
from app.schemas.cdr import CdrFilter

logger = logging.getLogger(__name__)

# The resolutions offered, in seconds, and the most points one series may have.
RESOLUTIONS = {"1s": 1, "5s": 5, "10s": 10, "30s": 30, "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600}
MAX_POINTS = 7200
MAX_GROUPS = 12
GROUP_BY = ("none", "service", "service_provider", "account", "location", "direction")

_SLICE_SQL = """
    CREATE TABLE slice AS
    SELECT {service_type}                                                   AS service,
           COALESCE(CAST(c.SERVICE_PROVIDER AS VARCHAR), 'Unknown')         AS provider,
           CAST(c.ACCOUNTID AS VARCHAR)                                      AS account,
           COALESCE(CAST(c.LOCATION_ID AS VARCHAR), '?')                     AS location,
           CASE c.CALLTYPE WHEN 0 THEN 'Dial In' WHEN 1 THEN 'Dial Out' ELSE 'Unknown' END AS direction,
           c.START_DATETIME                                                  AS s,
           GREATEST(COALESCE(c.RELEASE_DATETIME, c.START_DATETIME), c.START_DATETIME) AS r,
           (c.INCONF_DATETIME_EPOC IS NOT NULL AND c.INCONF_DATETIME_EPOC <> 0) AS ok
    {from_clause}
    {where}
      AND c.START_DATETIME IS NOT NULL
"""

_GROUP_COLUMN = {
    "none": "'All'",
    "service": "service",
    "service_provider": "provider",
    "account": "account",
    "location": "location",
    "direction": "direction",
}


class PortQueryError(ValueError):
    """The request cannot be answered as asked (window, resolution)."""


# ── The day's slice, kept for the last few days asked for ────────────────────

class _Slice:
    def __init__(self, connection: duckdb.DuckDBPyConnection, rows: int):
        self.connection = connection
        self.rows = rows
        self.lock = threading.Lock()


_SLICES: "OrderedDict[tuple[date, str], _Slice]" = OrderedDict()
_SLICES_LOCK = threading.Lock()
_KEEP = 3


def _slice(day: date, service: str) -> _Slice:
    key = (day, service)
    with _SLICES_LOCK:
        hit = _SLICES.get(key)
        if hit:
            _SLICES.move_to_end(key)
            return hit
    f = CdrFilter(date_from=day, date_to=day, service=service)
    # Always joined: the service column comes from CODR's MODULE_TYPE, and the
    # breakdown by service needs it whichever service is filtered to.
    from_clause, _ = _from_clause(f, joined=True)
    where = build_where(f)
    connection = duckdb.connect()
    try:
        connection.execute(
            _SLICE_SQL.format(service_type=SERVICE_TYPE_EXPR, from_clause=from_clause, where=where.sql),
            where.params,
        )
        rows = connection.execute("SELECT COUNT(*) FROM slice").fetchone()[0]
    except duckdb.Error as exc:
        connection.close()
        raise DatasetNotReady(f"Query failed against the lake: {exc}") from exc
    loaded = _Slice(connection, int(rows))
    with _SLICES_LOCK:
        _SLICES[key] = loaded
        while len(_SLICES) > _KEEP:
            _, old = _SLICES.popitem(last=False)
            old.connection.close()
    return loaded


# ── The arithmetic ──────────────────────────────────────────────────────────

def _filters(providers: list[str], accounts: list[str], locations: list[str]) -> tuple[str, list[Any]]:
    terms: list[str] = []
    params: list[Any] = []
    for column, values in (("provider", providers), ("account", accounts), ("location", locations)):
        if values:
            terms.append(f"{column} IN ({', '.join('?' for _ in values)})")
            params.extend(values)
    return (" AND ".join(terms) or "TRUE"), params


def _sweep(
    con: duckdb.DuckDBPyConnection,
    group_sql: str,
    group_params: list[Any],
    where: str,
    where_params: list[Any],
    ws: datetime,
    we: datetime,
    step: int,
) -> list[tuple]:
    """
    Per group and per bucket of `step` seconds from `ws`: the highest level
    reached, the level at the bucket's last event, and when the high was.
    Bucket -1 holds everything before the window — only its closing level is
    used, as the level carried into the window.
    """
    # Naive timestamps throughout, as DuckDB reads them: no local-zone shift.
    ws_ms = int((ws - datetime(1970, 1, 1)).total_seconds() * 1000)

    def sweep(only: Optional[str]) -> list[tuple]:
        # `only` sweeps one group on its own, with no PARTITION BY.
        pick = " AND g = ?" if only is not None else ""
        partition = "" if only is not None else "PARTITION BY g "
        sql = f"""
            WITH f AS (SELECT * FROM (SELECT {group_sql} AS g, s, r FROM slice WHERE {where}) WHERE TRUE{pick}),
            ev AS (
                SELECT g, s AS ts, 1 AS d FROM f
                UNION ALL
                SELECT g, r, -1 FROM f
            ),
            run AS (
                SELECT g, ts,
                       SUM(d) OVER ({partition}ORDER BY ts, d ROWS UNBOUNDED PRECEDING) AS act,
                       ROW_NUMBER() OVER ({partition}ORDER BY ts, d) AS n
                FROM ev
                WHERE ts < ?
            )
            SELECT g,
                   CASE WHEN ts < ? THEN -1
                        ELSE CAST(FLOOR((epoch_ms(ts) - ?) / ?) AS BIGINT) END AS b,
                   MAX(act)          AS peak,
                   arg_max(act, n)   AS closing,
                   arg_max(ts, act)  AS peak_ts,
                   MIN(ts)           AS first_ts
            FROM run
            GROUP BY 1, 2
        """
        extra = [only] if only is not None else []
        return con.execute(sql, [*group_params, *where_params, *extra, we, ws, ws_ms, step * 1000]).fetchall()

    # A window partitioned into a handful of very large groups is pathological
    # in DuckDB (measured: 2 service groups, 60 s; 9 providers, 1.2 s; one
    # unpartitioned total, 1.5 s). With so few groups, each is swept alone.
    values = [
        row[0]
        for row in con.execute(
            f"SELECT DISTINCT {group_sql} FROM slice WHERE {where}", [*group_params, *where_params]
        ).fetchall()
    ]
    if 1 < len(values) <= 4:
        return [row for value in values for row in sweep(str(value))]
    return sweep(None)


def _series(rows: list[tuple], buckets: int, ws: datetime, step: int) -> dict[str, dict[str, Any]]:
    """
    Fold sweep rows into a full series per group: a bucket with no event
    carries the level forward, and a bucket's peak is never below the level
    it opened at — unless its first event falls on its very first instant,
    in which case that level was never held inside it (a call releasing at
    10:30:00 is not in use in the 10:30 bucket).
    """
    by_group: dict[str, dict[int, tuple]] = {}
    for g, b, peak, closing, peak_ts, first_ts in rows:
        opens_on_event = b >= 0 and first_ts == ws + timedelta(seconds=int(b) * step)
        by_group.setdefault(str(g), {})[int(b)] = (int(peak), int(closing), peak_ts, opens_on_event)
    out: dict[str, dict[str, Any]] = {}
    for g, cells in by_group.items():
        level = cells.get(-1, (0, 0, None, False))[1]
        values: list[int] = []
        best, best_at = -1, None
        for b in range(buckets):
            cell = cells.get(b)
            if cell:
                carried = 0 if cell[3] else level
                peak = max(carried, cell[0])
                at = cell[2] if cell[0] >= carried else None
                level = cell[1]
            else:
                peak, at = level, None
            values.append(peak)
            if peak > best:
                best, best_at = peak, (at, b)
        out[g] = {"values": values, "peak": max(best, 0), "peak_bucket": best_at}
    return out


def _peak_time(series: dict[str, Any], ws: datetime, step: int) -> Optional[str]:
    marker = series.get("peak_bucket")
    if not marker:
        return None
    at, bucket = marker
    moment = at if isinstance(at, datetime) else ws + timedelta(seconds=bucket * step)
    return moment.isoformat(sep=" ", timespec="milliseconds")


def _label(group_by: str, key: str, names: dict[int, str]) -> str:
    if group_by == "account" and key.isdigit():
        name = names.get(int(key))
        return f"{key} · {name}" if name else key
    if group_by == "location" and key not in ("?", "Other"):
        return f"L{key}"
    if group_by == "service":
        return {"voicedrop": "Voicedrop", "conference": "Conference", "multicall": "MultiCall"}.get(key, key.title())
    return key


def analyze(
    *,
    day: date,
    service: str,
    time_from: time,
    time_to: time,
    resolution: str,
    group_by: str,
    providers: list[str],
    accounts: list[str],
    locations: list[str],
    top: int,
    capacity: Optional[int],
) -> dict[str, Any]:
    if resolution not in RESOLUTIONS:
        raise PortQueryError(f"resolution must be one of {', '.join(RESOLUTIONS)}.")
    if group_by not in GROUP_BY:
        raise PortQueryError(f"group_by must be one of {', '.join(GROUP_BY)}.")
    step = RESOLUTIONS[resolution]
    ws = datetime.combine(day, time_from)
    # The window's end is inclusive to the second it names.
    we = datetime.combine(day, time_to) + timedelta(seconds=1)
    if we <= ws:
        raise PortQueryError("The window's end must be after its start.")
    window_seconds = int((we - ws).total_seconds())
    buckets = -(-window_seconds // step)
    if buckets > MAX_POINTS:
        raise PortQueryError(
            f"{buckets:,} points at {resolution} over this window — the most is {MAX_POINTS:,}. "
            "Choose a coarser resolution or a shorter window."
        )
    top = max(1, min(top, MAX_GROUPS))

    sl = _slice(day, service)
    where, where_params = _filters(providers, accounts, locations)
    names = directory.accounts()
    group_col = _GROUP_COLUMN[group_by]

    with sl.lock:
        con = sl.connection

        # The total: one group, every call.
        total = _series(_sweep(con, "'All'", [], where, where_params, ws, we, step), buckets, ws, step).get("All")
        total = total or {"values": [0] * buckets, "peak": 0, "peak_bucket": None}
        peak_at = _peak_time(total, ws, step)

        # The groups: each one's own peak over the window first (one bucket),
        # then the biggest few named and the rest folded into "Other".
        groups_out: list[dict[str, Any]] = []
        group_series: dict[str, list[int]] = {}
        if group_by != "none":
            peaks = _series(_sweep(con, group_col, [], where, where_params, ws, we, window_seconds), 1, ws, window_seconds)
            ranked = sorted(peaks.items(), key=lambda kv: kv[1]["peak"], reverse=True)
            named = [g for g, _ in ranked[:top]]
            fold = len(ranked) > top
            mapped_sql = f"CASE WHEN {group_col} IN ({', '.join('?' for _ in named)}) THEN {group_col} ELSE 'Other' END" if fold else group_col
            mapped = _series(
                _sweep(con, mapped_sql, named if fold else [], where, where_params, ws, we, step), buckets, ws, step
            )
            stats = {
                str(row[0]): row[1:]
                for row in con.execute(
                    f"""
                    SELECT {mapped_sql} AS g,
                           COUNT(*) FILTER (WHERE s >= ? AND s < ?)              AS calls,
                           COUNT(*) FILTER (WHERE s >= ? AND s < ? AND ok)       AS connected,
                           SUM(GREATEST(0, epoch_ms(LEAST(r, ?)) - epoch_ms(GREATEST(s, ?)))) / 1000.0 AS port_seconds
                    FROM slice WHERE {where} AND s < ? AND r > ?
                    GROUP BY 1
                    """,
                    [*(named if fold else []), ws, we, ws, we, we, ws, *where_params, we, ws],
                ).fetchall()
            }
            for g, series in sorted(mapped.items(), key=lambda kv: (kv[0] == "Other", -kv[1]["peak"])):
                calls, connected, port_seconds = stats.get(g, (0, 0, 0.0))
                group_series[g] = series["values"]
                groups_out.append({
                    "key": g,
                    "label": "Other" if g == "Other" and fold else _label(group_by, g, names),
                    "peak": series["peak"],
                    "peak_at": _peak_time(series, ws, step),
                    "calls": int(calls or 0),
                    "connected": int(connected or 0),
                    "avg_ports": round(float(port_seconds or 0) / window_seconds, 2),
                    "is_other": g == "Other" and fold,
                    "members": len(ranked) - top if g == "Other" and fold else None,
                })

        calls, connected, port_seconds, longest = con.execute(
            f"""
            SELECT COUNT(*) FILTER (WHERE s >= ? AND s < ?),
                   COUNT(*) FILTER (WHERE s >= ? AND s < ? AND ok),
                   SUM(GREATEST(0, epoch_ms(LEAST(r, ?)) - epoch_ms(GREATEST(s, ?)))) / 1000.0,
                   MAX(epoch_ms(r) - epoch_ms(s)) / 1000.0
            FROM slice WHERE {where} AND s < ? AND r > ?
            """,
            [ws, we, ws, we, we, ws, *where_params, we, ws],
        ).fetchone()

        # Time above the capacity line: the stretches between events while the
        # level stood above it, clipped to the window.
        above_seconds = None
        if capacity is not None:
            above_seconds = con.execute(
                f"""
                WITH f AS (SELECT s, r FROM slice WHERE {where}),
                ev AS (SELECT s AS ts, 1 AS d FROM f UNION ALL SELECT r, -1 FROM f),
                run AS (
                    SELECT ts,
                           SUM(d) OVER (ORDER BY ts, d ROWS UNBOUNDED PRECEDING) AS act,
                           LEAD(ts) OVER (ORDER BY ts, d) AS nxt
                    FROM ev
                )
                SELECT COALESCE(SUM(GREATEST(0, epoch_ms(LEAST(nxt, ?)) - epoch_ms(GREATEST(ts, ?)))), 0) / 1000.0
                FROM run WHERE act > ? AND nxt IS NOT NULL AND nxt > ? AND ts < ?
                """,
                [*where_params, we, ws, capacity, ws, we],
            ).fetchone()[0]

        # Who held the ports at the peak instant.
        at_peak: dict[str, list[dict[str, Any]]] = {}
        if peak_at:
            moment = datetime.fromisoformat(peak_at)
            for key, column in (("service", "service"), ("service_provider", "provider"), ("account", "account"), ("direction", "direction")):
                rows = con.execute(
                    f"""
                    SELECT {column}, COUNT(*) FROM slice
                    WHERE {where} AND s <= ? AND r > ?
                    GROUP BY 1 ORDER BY 2 DESC LIMIT 10
                    """,
                    [*where_params, moment, moment],
                ).fetchall()
                at_peak[key] = [{"key": str(k), "label": _label(key, str(k), names), "ports": int(n)} for k, n in rows]

        # What there is to filter by, for this day and service.
        def options(column: str, limit: int) -> list[dict[str, Any]]:
            rows = con.execute(
                f"SELECT {column}, COUNT(*) FROM slice GROUP BY 1 ORDER BY 2 DESC LIMIT {int(limit)}"
            ).fetchall()
            kind = {"provider": "service_provider", "account": "account", "location": "location"}[column]
            return [{"key": str(k), "label": _label(kind, str(k), names), "calls": int(n)} for k, n in rows]

        filter_options = {
            "service_providers": options("provider", 100),
            "accounts": options("account", 500),
            "locations": options("location", 100),
        }

    labels = [(ws + timedelta(seconds=i * step)).strftime("%H:%M:%S") for i in range(buckets)]
    peak_value = total["peak"]
    busiest = None
    if buckets and step < 3600:
        per_hour: dict[int, int] = {}
        for i, value in enumerate(total["values"]):
            hour = (ws + timedelta(seconds=i * step)).hour
            per_hour[hour] = max(per_hour.get(hour, 0), value)
        busiest_hour = max(per_hour, key=lambda h: (per_hour[h], -h))
        busiest = {"hour": busiest_hour, "peak": per_hour[busiest_hour]}

    return {
        "date": day.isoformat(),
        "service": service,
        "window": {"from": ws.isoformat(sep=" "), "to": (we - timedelta(seconds=1)).isoformat(sep=" "), "seconds": window_seconds},
        "resolution": resolution,
        "step_seconds": step,
        "group_by": group_by,
        "rows_in_day": sl.rows,
        "summary": {
            "peak": peak_value,
            "peak_at": peak_at,
            "avg_ports": round(float(port_seconds or 0) / window_seconds, 2),
            "calls": int(calls or 0),
            "connected": int(connected or 0),
            "longest_call_seconds": round(float(longest or 0)),
            "capacity": capacity,
            "above_capacity_seconds": None if above_seconds is None else round(float(above_seconds)),
            "busiest_hour": busiest,
        },
        "labels": labels,
        "total": total["values"],
        "groups": groups_out,
        "group_series": group_series,
        "at_peak": at_peak,
        "options": filter_options,
    }
