"""
Voicedrop Summary — account history and business-wide views, read from the
same q100_dump.voicedrop_summary table as the Campaigns tab (one row per
campaign per day; see voicedrop_summary.py).

The table is small (thousands of rows), so each view is one or two grouped
SELECTs and the rest is arithmetic here, in pure functions over the grouped
rows — which is also what the tests exercise. Nothing here ever writes.

Definitions used throughout, the same as the Campaigns table:
    dialed        = Connected + Not_Connected
    connect rate  = Connected / dialed
    DND %         = DND_Count / PhoneNumber_Count
    minutes       = Connected_Duration (already in minutes)

"Today" is the latest date in the table (`as_of`), not the clock: the table is
loaded a day behind, and measuring "idle for 15 days" against the clock would
call every account asleep whenever a load is late.
"""

from collections import defaultdict
from datetime import date, timedelta
from statistics import median
from typing import Any, Iterable, Optional

from sqlalchemy import text

from app.cdr.voicedrop_summary import _engine


# ── SQL ─────────────────────────────────────────────────────────────────────

# One row per account per day — everything else is folded from these.
_DAILY_SQL = """
    SELECT `Date` AS day, Account_ID AS account_id,
           COUNT(*) AS campaigns,
           COALESCE(SUM(PhoneNumber_Count), 0) AS phone_numbers,
           COALESCE(SUM(DND_Count), 0) AS dnd,
           COALESCE(SUM(Connected), 0) AS connected,
           COALESCE(SUM(Not_Connected), 0) AS not_connected,
           COALESCE(SUM(Connected_Duration), 0) AS minutes,
           COALESCE(SUM(UnBlast_Count), 0) AS unblast
    FROM voicedrop_summary
    {where}
    GROUP BY `Date`, Account_ID
    ORDER BY `Date`
"""

_CLIENTS_SQL = """
    SELECT Account_ID AS account_id,
           GROUP_CONCAT(DISTINCT Client_ID ORDER BY Client_ID) AS client_ids
    FROM voicedrop_summary
    {where}
    GROUP BY Account_ID
"""

# MySQL WEEKDAY(): 0 = Monday … 6 = Sunday.
_WEEKDAY_HOUR_SQL = """
    SELECT WEEKDAY(`Date`) AS weekday, HOUR(Start_Time) AS hour,
           COUNT(*) AS campaigns,
           COALESCE(SUM(Connected), 0) + COALESCE(SUM(Not_Connected), 0) AS dialed
    FROM voicedrop_summary
    WHERE Start_Time IS NOT NULL {and_where}
    GROUP BY WEEKDAY(`Date`), HOUR(Start_Time)
"""

_START_TIMES_SQL = """
    SELECT `Date` AS day, TIME_TO_SEC(Start_Time) AS seconds
    FROM voicedrop_summary
    WHERE Account_ID = :account_id AND Start_Time IS NOT NULL
"""


def _fetch(sql: str, params: Optional[dict] = None) -> list[dict[str, Any]]:
    with _engine().connect() as connection:
        return [dict(row) for row in connection.execute(text(sql), params or {}).mappings().all()]


def _daily_rows(account_id: Optional[int] = None) -> list[dict[str, Any]]:
    where = "WHERE Account_ID = :account_id" if account_id is not None else ""
    rows = _fetch(_DAILY_SQL.format(where=where), {"account_id": account_id})
    for row in rows:
        for key in ("campaigns", "phone_numbers", "dnd", "connected", "not_connected", "minutes", "unblast"):
            row[key] = int(row[key] or 0)
        row["dialed"] = row["connected"] + row["not_connected"]
    return rows


def _client_ids(account_id: Optional[int] = None) -> dict[int, list[int]]:
    where = "WHERE Account_ID = :account_id" if account_id is not None else ""
    rows = _fetch(_CLIENTS_SQL.format(where=where), {"account_id": account_id})
    return {
        row["account_id"]: [int(c) for c in str(row["client_ids"] or "").split(",") if c]
        for row in rows
    }


def _weekday_hour(account_id: Optional[int] = None) -> list[dict[str, int]]:
    and_where = "AND Account_ID = :account_id" if account_id is not None else ""
    rows = _fetch(_WEEKDAY_HOUR_SQL.format(and_where=and_where), {"account_id": account_id})
    return [
        {"weekday": int(r["weekday"]), "hour": int(r["hour"]), "campaigns": int(r["campaigns"]), "dialed": int(r["dialed"] or 0)}
        for r in rows
    ]


# ── Arithmetic ─────────────────────────────────────────────────────────────

_SUMMED = ("campaigns", "phone_numbers", "dnd", "connected", "not_connected", "dialed", "minutes", "unblast")


def _rate(part: float, whole: float, digits: int = 1) -> float:
    return round(part / whole * 100, digits) if whole else 0.0


def _totals(rows: Iterable[dict[str, Any]]) -> dict[str, int]:
    out = {key: 0 for key in _SUMMED}
    days: set = set()
    for row in rows:
        for key in _SUMMED:
            out[key] += row[key]
        days.add(row["day"])
    out["active_days"] = len(days)
    return out


def _between(rows: list[dict[str, Any]], start: date, end: date) -> list[dict[str, Any]]:
    return [row for row in rows if start <= row["day"] <= end]


def _month_key(day: date) -> str:
    return f"{day.year:04d}-{day.month:02d}"


def _previous_month_span(as_of: date) -> tuple[date, date, date, date]:
    """This month so far, and the same days of the month before (clamped to its length)."""
    current_start = as_of.replace(day=1)
    previous_end_of_month = current_start - timedelta(days=1)
    previous_start = previous_end_of_month.replace(day=1)
    previous_end = previous_start.replace(day=min(as_of.day, previous_end_of_month.day))
    return current_start, as_of, previous_start, previous_end


def daily_totals(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Accounts summed per day: the calendar and the busiest-days ranking."""
    by_day: dict[date, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_day[row["day"]].append(row)
    out = []
    for day in sorted(by_day):
        totals = _totals(by_day[day])
        totals.pop("active_days")
        out.append({"date": day.isoformat(), "accounts": len({r["account_id"] for r in by_day[day]}), **totals})
    return out


def monthly_totals(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One line per month: the trend chart and the monthly statement."""
    by_month: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_month[_month_key(row["day"])].append(row)
    out = []
    for month in sorted(by_month):
        totals = _totals(by_month[month])
        out.append({
            "month": month,
            **totals,
            "connect_rate": _rate(totals["connected"], totals["dialed"]),
            # Two places: DND is often a fraction of a percent, and 0.0 hides it.
            "dnd_rate": _rate(totals["dnd"], totals["phone_numbers"], 2),
        })
    return out


def account_list(rows: list[dict[str, Any]], clients: dict[int, list[int]], as_of: date) -> list[dict[str, Any]]:
    """
    Every account with its lifetime figures, when it was last seen, and what it
    "used to send": the numbers it dialed in the 90 days up to its last active
    day — the size of what goes quiet when it stops.
    """
    by_account: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_account[row["account_id"]].append(row)
    out = []
    for account_id, account_rows in by_account.items():
        first = min(r["day"] for r in account_rows)
        last = max(r["day"] for r in account_rows)
        totals = _totals(account_rows)
        recent = _totals(_between(account_rows, last - timedelta(days=89), last))
        out.append({
            "account_id": account_id,
            "client_ids": clients.get(account_id, []),
            "first_date": first.isoformat(),
            "last_date": last.isoformat(),
            "days_idle": (as_of - last).days,
            "campaigns": totals["campaigns"],
            "active_days": totals["active_days"],
            "dialed": totals["dialed"],
            "connected": totals["connected"],
            "minutes": totals["minutes"],
            "dialed_last_90_active": recent["dialed"],
        })
    out.sort(key=lambda a: a["dialed"], reverse=True)
    return out


def movers(rows: list[dict[str, Any]], as_of: date) -> dict[str, Any]:
    """
    This month so far against the same days of last month, per account.

    Same days, not the whole of last month: on the 26th, a full month against
    26 days would show nearly everyone falling.
    """
    current_start, current_end, previous_start, previous_end = _previous_month_span(as_of)
    current: dict[int, dict[str, int]] = defaultdict(lambda: {"dialed": 0, "minutes": 0})
    previous: dict[int, dict[str, int]] = defaultdict(lambda: {"dialed": 0, "minutes": 0})
    for row in rows:
        bucket = (
            current if current_start <= row["day"] <= current_end
            else previous if previous_start <= row["day"] <= previous_end
            else None
        )
        if bucket is not None:
            bucket[row["account_id"]]["dialed"] += row["dialed"]
            bucket[row["account_id"]]["minutes"] += row["minutes"]
    accounts = []
    for account_id in set(current) | set(previous):
        now, before = current[account_id], previous[account_id]
        accounts.append({
            "account_id": account_id,
            "current_dialed": now["dialed"],
            "previous_dialed": before["dialed"],
            "current_minutes": now["minutes"],
            "previous_minutes": before["minutes"],
            "change": now["dialed"] - before["dialed"],
            "change_pct": _rate(now["dialed"] - before["dialed"], before["dialed"]) if before["dialed"] else None,
        })
    accounts.sort(key=lambda a: a["change"], reverse=True)
    return {
        "current_from": current_start.isoformat(),
        "current_to": current_end.isoformat(),
        "previous_from": previous_start.isoformat(),
        "previous_to": previous_end.isoformat(),
        "accounts": accounts,
    }


def new_accounts(rows: list[dict[str, Any]], first_day: date) -> list[dict[str, Any]]:
    """
    Accounts by the month of their first campaign in the table.

    The table's first month is flagged: every account already running then
    "starts" in it, so its count says when the table began, not who joined.
    """
    first_seen: dict[int, date] = {}
    for row in rows:
        seen = first_seen.get(row["account_id"])
        if seen is None or row["day"] < seen:
            first_seen[row["account_id"]] = row["day"]
    by_month: dict[str, list[int]] = defaultdict(list)
    for account_id, day in first_seen.items():
        by_month[_month_key(day)].append(account_id)
    return [
        {"month": month, "accounts": sorted(ids), "is_table_start": month == _month_key(first_day)}
        for month, ids in sorted(by_month.items())
    ]


def habits(rows: list[dict[str, Any]], start_times: list[dict[str, Any]], as_of: date) -> dict[str, Any]:
    """
    How the account behaves, over its last 90 days (or its whole history when
    it has been quiet that long).
    """
    if not rows:
        return {}
    last = max(r["day"] for r in rows)
    window_start = as_of - timedelta(days=89)
    window = _between(rows, window_start, as_of)
    scope = "90d"
    if not window:
        window, scope = rows, "all"
        window_start = min(r["day"] for r in rows)
    totals = _totals(window)
    current_start, _, previous_start, _ = _previous_month_span(as_of)
    previous_month_end = current_start - timedelta(days=1)

    seconds = [
        int(s["seconds"]) for s in start_times
        if s["seconds"] is not None and (scope == "all" or s["day"] >= window_start)
    ]
    usual_start = None
    busiest_hour = None
    if seconds:
        mid = int(median(seconds))
        usual_start = f"{mid // 3600:02d}:{mid % 3600 // 60:02d}"
        hours: dict[int, int] = defaultdict(int)
        for value in seconds:
            hours[value // 3600] += 1
        busiest_hour = max(hours, key=lambda h: (hours[h], -h))

    return {
        "scope": scope,
        "active_days_this_month": len({r["day"] for r in _between(rows, current_start, as_of)}),
        "active_days_last_month": len({r["day"] for r in _between(rows, previous_start, previous_month_end)}),
        "campaigns_per_active_day": round(totals["campaigns"] / totals["active_days"], 1) if totals["active_days"] else 0,
        "avg_campaign_size": round(totals["phone_numbers"] / totals["campaigns"]) if totals["campaigns"] else 0,
        "avg_dialed_per_campaign": round(totals["dialed"] / totals["campaigns"]) if totals["campaigns"] else 0,
        "usual_start": usual_start,
        "busiest_hour": busiest_hour,
        "last_active": last.isoformat(),
        "days_since_active": (as_of - last).days,
    }


def _daily_out(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{"date": r["day"].isoformat(), **{k: r[k] for k in _SUMMED}} for r in rows]


# ── Views ───────────────────────────────────────────────────────────────────

def overview() -> dict[str, Any]:
    """Everything the All accounts tab draws, in one read."""
    rows = _daily_rows()
    if not rows:
        return {"as_of": None, "first_date": None}
    first_day = min(r["day"] for r in rows)
    as_of = max(r["day"] for r in rows)
    current_start, current_end, previous_start, previous_end = _previous_month_span(as_of)
    this_month = _totals(_between(rows, current_start, current_end))
    last_month = _totals(_between(rows, previous_start, previous_end))
    recent = _between(rows, as_of - timedelta(days=29), as_of)
    before = _between(rows, as_of - timedelta(days=59), as_of - timedelta(days=30))
    return {
        "as_of": as_of.isoformat(),
        "first_date": first_day.isoformat(),
        "kpis": {
            "active_accounts_30d": len({r["account_id"] for r in recent}),
            "active_accounts_prev_30d": len({r["account_id"] for r in before}),
            "this_month": {**this_month, "connect_rate": _rate(this_month["connected"], this_month["dialed"])},
            "last_month_same_days": {**last_month, "connect_rate": _rate(last_month["connected"], last_month["dialed"])},
        },
        "daily": daily_totals(rows),
        "weekday_hour": _weekday_hour(),
        "accounts": account_list(rows, _client_ids(), as_of),
        "movers": movers(rows, as_of),
        "new_accounts": new_accounts(rows, first_day),
        "months": sorted({_month_key(r["day"]) for r in rows}),
    }


def account(account_id: int) -> Optional[dict[str, Any]]:
    """One account's history: its calendar, months, habits and hours."""
    rows = _daily_rows(account_id)
    if not rows:
        return None
    as_of_row = _fetch("SELECT MAX(`Date`) AS as_of FROM voicedrop_summary")
    as_of = as_of_row[0]["as_of"] if as_of_row and as_of_row[0]["as_of"] else max(r["day"] for r in rows)
    return {
        "account_id": account_id,
        "client_ids": _client_ids(account_id).get(account_id, []),
        "as_of": as_of.isoformat(),
        "first_date": min(r["day"] for r in rows).isoformat(),
        "last_date": max(r["day"] for r in rows).isoformat(),
        "daily": _daily_out(rows),
        "monthly": monthly_totals(rows),
        "habits": habits(rows, _fetch(_START_TIMES_SQL, {"account_id": account_id}), as_of),
        "weekday_hour": _weekday_hour(account_id),
    }


def statement(month: Optional[str] = None) -> list[dict[str, Any]]:
    """
    Per account, per month: campaigns, dialed, connected and minutes — the
    billing statement. One month, or every month when none is given.
    """
    rows = _daily_rows()
    clients = _client_ids()
    by_key: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        key = _month_key(row["day"])
        if month is None or key == month:
            by_key[(row["account_id"], key)].append(row)
    out = []
    for (account_id, key), account_rows in by_key.items():
        totals = _totals(account_rows)
        out.append({
            "month": key,
            "account_id": account_id,
            "client_ids": clients.get(account_id, []),
            **totals,
            "connect_rate": _rate(totals["connected"], totals["dialed"]),
        })
    out.sort(key=lambda r: (r["month"], -r["dialed"]))
    return out
