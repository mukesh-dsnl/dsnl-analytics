"""
Conference › Summary — account history and business-wide views, read from
q100_dump.conference_summary (one row per conference per day; see
conference_summary.py for the columns). The Voicedrop Summary's twin
(voicedrop_insights.py), with a conference's own measures:

    conferences   rooms (CRN + Conf_Num) held
    ringed        conferees dialled into them      (Total_Ringed_Calls)
    connected     of those, how many joined       (Total_Connected_Calls)
    connect rate  connected / ringed
    attended min  minutes joined to release        (Total_Attended_Duration)
    call min      minutes start to release         (Total_Call_Duration)
    empty rooms   conferences nobody joined        (connected = 0)

Attended minutes are the usage measure here — what a room was actually used
for — the way numbers dialed are for Voicedrop. "Today" is the latest date in
the table, as there. Nothing here ever writes.
"""

from collections import defaultdict
from datetime import date, timedelta
from statistics import median
from typing import Any, Iterable, Optional

from sqlalchemy import text

from app.cdr import directory
from app.cdr.voicedrop_insights import _between, _month_key, _previous_month_span, _rate, new_accounts
from app.cdr.voicedrop_summary import _engine

# One row per account per day.
_DAILY_SQL = """
    SELECT Call_Date AS day, Account_ID AS account_id,
           COUNT(*) AS conferences,
           COALESCE(SUM(Total_Ringed_Calls), 0) AS ringed,
           COALESCE(SUM(Total_Connected_Calls), 0) AS connected,
           COALESCE(SUM(Total_Call_Duration), 0) AS call_minutes,
           COALESCE(SUM(Total_Attended_Duration), 0) AS attended_minutes,
           COALESCE(MAX(Peak_Port_Used), 0) AS peak_port,
           SUM(COALESCE(Total_Connected_Calls, 0) = 0) AS empty_rooms
    FROM conference_summary
    {where}
    GROUP BY Call_Date, Account_ID
    ORDER BY Call_Date
"""

# The name an account was last seen under — names are edited over time.
_NAMES_SQL = """
    SELECT s.Account_ID AS account_id, s.Account_Name AS name
    FROM conference_summary s
    JOIN (
        SELECT Account_ID, MAX(Call_Date) AS last_day
        FROM conference_summary
        WHERE Account_Name IS NOT NULL AND Account_Name <> ''
        {and_where}
        GROUP BY Account_ID
    ) latest ON latest.Account_ID = s.Account_ID AND latest.last_day = s.Call_Date
    WHERE s.Account_Name IS NOT NULL AND s.Account_Name <> ''
"""

# MySQL WEEKDAY(): 0 = Monday … 6 = Sunday.
_WEEKDAY_HOUR_SQL = """
    SELECT WEEKDAY(Call_Date) AS weekday, HOUR(Start_Time) AS hour,
           COUNT(*) AS conferences,
           COALESCE(SUM(Total_Connected_Calls), 0) AS connected
    FROM conference_summary
    WHERE Start_Time IS NOT NULL {and_where}
    GROUP BY WEEKDAY(Call_Date), HOUR(Start_Time)
"""

_TIMES_SQL = """
    SELECT Call_Date AS day, TIME_TO_SEC(Start_Time) AS start_s, TIME_TO_SEC(End_Time) AS end_s
    FROM conference_summary
    WHERE Account_ID = :account_id AND Start_Time IS NOT NULL
"""

_SUMMED = ("conferences", "ringed", "connected", "call_minutes", "attended_minutes", "empty_rooms")


def _fetch(sql: str, params: Optional[dict] = None) -> list[dict[str, Any]]:
    with _engine().connect() as connection:
        return [dict(row) for row in connection.execute(text(sql), params or {}).mappings().all()]


def _daily_rows(account_id: Optional[int] = None) -> list[dict[str, Any]]:
    where = "WHERE Account_ID = :account_id" if account_id is not None else ""
    rows = _fetch(_DAILY_SQL.format(where=where), {"account_id": account_id})
    for row in rows:
        for key in (*_SUMMED, "peak_port"):
            row[key] = int(row[key] or 0)
    return rows


def _names(account_id: Optional[int] = None) -> dict[int, str]:
    """
    The account master list's name (accounts.parquet), the same one every
    page shows; the name the conference was last held under when the list
    has none.
    """
    and_where = "AND Account_ID = :account_id" if account_id is not None else ""
    seen = {r["account_id"]: r["name"] for r in _fetch(_NAMES_SQL.format(and_where=and_where), {"account_id": account_id})}
    master = directory.accounts()
    return {aid: master.get(aid) or name for aid, name in seen.items()}


def _weekday_hour(account_id: Optional[int] = None) -> list[dict[str, int]]:
    and_where = "AND Account_ID = :account_id" if account_id is not None else ""
    return [
        {"weekday": int(r["weekday"]), "hour": int(r["hour"]), "conferences": int(r["conferences"]), "connected": int(r["connected"] or 0)}
        for r in _fetch(_WEEKDAY_HOUR_SQL.format(and_where=and_where), {"account_id": account_id})
    ]


def _totals(rows: Iterable[dict[str, Any]]) -> dict[str, int]:
    out = {key: 0 for key in _SUMMED}
    out["peak_port"] = 0
    days: set = set()
    for row in rows:
        for key in _SUMMED:
            out[key] += row[key]
        out["peak_port"] = max(out["peak_port"], row["peak_port"])
        days.add(row["day"])
    out["active_days"] = len(days)
    return out


def _with_rates(totals: dict[str, int]) -> dict[str, Any]:
    return {
        **totals,
        "connect_rate": _rate(totals["connected"], totals["ringed"]),
        "empty_rate": _rate(totals["empty_rooms"], totals["conferences"]),
        "parties_per_conference": round(totals["connected"] / totals["conferences"], 1) if totals["conferences"] else 0,
    }


def daily_totals(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
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
    by_month: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_month[_month_key(row["day"])].append(row)
    return [{"month": month, **_with_rates(_totals(by_month[month]))} for month in sorted(by_month)]


def account_list(rows: list[dict[str, Any]], names: dict[int, str], as_of: date) -> list[dict[str, Any]]:
    """Every account, lifetime figures, and the attended minutes of its 90 days up to its last conference."""
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
            "name": names.get(account_id),
            "first_date": first.isoformat(),
            "last_date": last.isoformat(),
            "days_idle": (as_of - last).days,
            "conferences": totals["conferences"],
            "active_days": totals["active_days"],
            "connected": totals["connected"],
            "attended_minutes": totals["attended_minutes"],
            "attended_last_90_active": recent["attended_minutes"],
        })
    out.sort(key=lambda a: a["attended_minutes"], reverse=True)
    return out


def movers(rows: list[dict[str, Any]], as_of: date) -> dict[str, Any]:
    """Attended minutes this month so far against the same days of last month, per account."""
    current_start, current_end, previous_start, previous_end = _previous_month_span(as_of)
    current: dict[int, dict[str, int]] = defaultdict(lambda: {"minutes": 0, "conferences": 0})
    previous: dict[int, dict[str, int]] = defaultdict(lambda: {"minutes": 0, "conferences": 0})
    for row in rows:
        bucket = (
            current if current_start <= row["day"] <= current_end
            else previous if previous_start <= row["day"] <= previous_end
            else None
        )
        if bucket is not None:
            bucket[row["account_id"]]["minutes"] += row["attended_minutes"]
            bucket[row["account_id"]]["conferences"] += row["conferences"]
    accounts = []
    for account_id in set(current) | set(previous):
        now, before = current[account_id], previous[account_id]
        accounts.append({
            "account_id": account_id,
            "current": now["minutes"],
            "previous": before["minutes"],
            "current_conferences": now["conferences"],
            "previous_conferences": before["conferences"],
            "change": now["minutes"] - before["minutes"],
        })
    accounts.sort(key=lambda a: a["change"], reverse=True)
    return {
        "current_from": current_start.isoformat(),
        "current_to": current_end.isoformat(),
        "previous_from": previous_start.isoformat(),
        "previous_to": previous_end.isoformat(),
        "accounts": accounts,
    }


def habits(rows: list[dict[str, Any]], times: list[dict[str, Any]], as_of: date) -> dict[str, Any]:
    """How the account meets, over its last 90 days (or its whole history when quiet that long)."""
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

    in_window = [t for t in times if t["start_s"] is not None and (scope == "all" or t["day"] >= window_start)]
    starts = [int(t["start_s"]) for t in in_window]
    lengths = [((int(t["end_s"]) - int(t["start_s"])) % 86400) / 60 for t in in_window if t["end_s"] is not None]
    usual_start = busiest_hour = None
    if starts:
        mid = int(median(starts))
        usual_start = f"{mid // 3600:02d}:{mid % 3600 // 60:02d}"
        hours: dict[int, int] = defaultdict(int)
        for value in starts:
            hours[value // 3600] += 1
        busiest_hour = max(hours, key=lambda h: (hours[h], -h))

    return {
        "scope": scope,
        "active_days_this_month": len({r["day"] for r in _between(rows, current_start, as_of)}),
        "active_days_last_month": len({r["day"] for r in _between(rows, previous_start, previous_month_end)}),
        "conferences_per_active_day": round(totals["conferences"] / totals["active_days"], 1) if totals["active_days"] else 0,
        "parties_per_conference": round(totals["connected"] / totals["conferences"], 1) if totals["conferences"] else 0,
        "median_length_minutes": round(median(lengths)) if lengths else None,
        "usual_start": usual_start,
        "busiest_hour": busiest_hour,
        "last_active": last.isoformat(),
        "days_since_active": (as_of - last).days,
    }


def _daily_out(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{"date": r["day"].isoformat(), **{k: r[k] for k in (*_SUMMED, "peak_port")}} for r in rows]


# ── Views ───────────────────────────────────────────────────────────────────

def overview() -> dict[str, Any]:
    """Everything the All accounts tab draws, in one read."""
    rows = _daily_rows()
    if not rows:
        return {"as_of": None, "first_date": None}
    first_day = min(r["day"] for r in rows)
    as_of = max(r["day"] for r in rows)
    current_start, current_end, previous_start, previous_end = _previous_month_span(as_of)
    recent = _between(rows, as_of - timedelta(days=29), as_of)
    before = _between(rows, as_of - timedelta(days=59), as_of - timedelta(days=30))
    return {
        "as_of": as_of.isoformat(),
        "first_date": first_day.isoformat(),
        "kpis": {
            "active_accounts_30d": len({r["account_id"] for r in recent}),
            "active_accounts_prev_30d": len({r["account_id"] for r in before}),
            "this_month": _with_rates(_totals(_between(rows, current_start, current_end))),
            "last_month_same_days": _with_rates(_totals(_between(rows, previous_start, previous_end))),
        },
        "daily": daily_totals(rows),
        "weekday_hour": _weekday_hour(),
        "accounts": account_list(rows, _names(), as_of),
        "movers": movers(rows, as_of),
        "new_accounts": new_accounts(rows, first_day),
        "months": sorted({_month_key(r["day"]) for r in rows}),
    }


def account(account_id: int) -> Optional[dict[str, Any]]:
    """One account's history: its calendar, months, habits and hours."""
    rows = _daily_rows(account_id)
    if not rows:
        return None
    as_of_row = _fetch("SELECT MAX(Call_Date) AS as_of FROM conference_summary")
    as_of = as_of_row[0]["as_of"] if as_of_row and as_of_row[0]["as_of"] else max(r["day"] for r in rows)
    return {
        "account_id": account_id,
        "name": _names(account_id).get(account_id),
        "as_of": as_of.isoformat(),
        "first_date": min(r["day"] for r in rows).isoformat(),
        "last_date": max(r["day"] for r in rows).isoformat(),
        "daily": _daily_out(rows),
        "monthly": monthly_totals(rows),
        "habits": habits(rows, _fetch(_TIMES_SQL, {"account_id": account_id}), as_of),
        "weekday_hour": _weekday_hour(account_id),
    }


def statement(month: Optional[str] = None) -> list[dict[str, Any]]:
    """Per account, per month: conferences, parties, minutes — one month, or every month."""
    rows = _daily_rows()
    names = _names()
    by_key: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        key = _month_key(row["day"])
        if month is None or key == month:
            by_key[(row["account_id"], key)].append(row)
    out = [
        {"month": key, "account_id": account_id, "name": names.get(account_id), **_with_rates(_totals(account_rows))}
        for (account_id, key), account_rows in by_key.items()
    ]
    out.sort(key=lambda r: (r["month"], -r["attended_minutes"]))
    return out
