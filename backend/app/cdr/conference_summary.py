"""
Conference › Summary — read from the reporting team's two tables in q100_dump
on 192.168.0.117, through the same connection as voicedrop_summary.py
(VOICEDROP_SUMMARY_DATABASE_URL). Nothing here ever writes.

conference_summary — one row per conference (CRN + Conf_Num) per day, built
by local_reports/SQL/stats/conference_detail.sql:
    Total_Ringed_Calls       distinct conferees dialled into the room
    Total_Connected_Calls    of those, how many joined (INCONF set)
    Total_Call_Duration      minutes, start to release, summed over legs
    Total_Attended_Duration  minutes, joined to release, summed over legs
    Peak_Port_Used           the highest port number any leg used

conference_daily_summary — one row per day, built by stats/acs_summary.sql:
CODR record counts by module type (ACS 1, Proxy 2, Multicall 4) and rooms by
how many parties connected (0, 1, 2, 3, more than 3).

The daily table can be empty (it is, at the time of writing) or lag the
detail table, so the daily view is always rolled up from conference_summary
and the daily table's own figures are laid over it for the days it has.
Rooms by connected parties come out the same either way — a room's
Total_Connected_Calls is the very count acs_summary.sql buckets — but the
module-type split exists only in the daily table.
"""

from datetime import date, time, timedelta
from typing import Any, Optional

from sqlalchemy import text

from app.cdr.voicedrop_summary import _engine, _time

_RECORDS_SQL = """
    SELECT Call_Date, Account_ID, CRN, Conf_Num, Start_Time, End_Time,
           Account_Name, Conference_Name, PIN, DID,
           Total_Ringed_Calls, Total_Connected_Calls, Total_Call_Duration,
           Total_Attended_Duration, Peak_Port_Used
    FROM conference_summary
    WHERE Call_Date = :day
    ORDER BY Start_Time, CRN, Conf_Num
"""

# One line per day, folded from the detail rows.
_ROLLUP_SQL = """
    SELECT Call_Date AS day,
           COUNT(*) AS conferences,
           COUNT(DISTINCT Account_ID) AS accounts,
           COALESCE(SUM(Total_Ringed_Calls), 0) AS ringed,
           COALESCE(SUM(Total_Connected_Calls), 0) AS connected,
           COALESCE(SUM(Total_Call_Duration), 0) AS call_minutes,
           COALESCE(SUM(Total_Attended_Duration), 0) AS attended_minutes,
           COALESCE(MAX(Peak_Port_Used), 0) AS peak_port,
           SUM(COALESCE(Total_Connected_Calls, 0) = 0) AS party_0,
           SUM(Total_Connected_Calls = 1) AS party_1,
           SUM(Total_Connected_Calls = 2) AS party_2,
           SUM(Total_Connected_Calls = 3) AS party_3,
           SUM(Total_Connected_Calls > 3) AS party_above_3
    FROM conference_summary
    WHERE Call_Date BETWEEN :start AND :end
    GROUP BY Call_Date
    ORDER BY Call_Date DESC
"""

_DAILY_TABLE_SQL = """
    SELECT Call_Date AS day, Total_Count, ACS_Count, Proxy_Count, Multicall_Count,
           Party_0, Party_1, Party_2, Party_3, Party_Above_3
    FROM conference_daily_summary
    WHERE Call_Date BETWEEN :start AND :end
"""

_RANGE_SQL = """
    SELECT MIN(Call_Date) AS first, MAX(Call_Date) AS last, COUNT(*) AS conferences
    FROM conference_summary
"""

_DAILY_RANGE_SQL = "SELECT COUNT(*) AS days, MAX(Call_Date) AS last FROM conference_daily_summary"


def _fetch(sql: str, params: Optional[dict] = None) -> list[dict[str, Any]]:
    with _engine().connect() as connection:
        return [dict(row) for row in connection.execute(text(sql), params or {}).mappings().all()]


def _int(value: Any) -> int:
    return int(value or 0)


def _dids(value: Optional[str]) -> list[str]:
    """'34168016.0, 34170005.0' → ['34168016', '34170005']: the float tails are an export artefact."""
    out = []
    for part in (value or "").split(","):
        part = part.strip()
        if not part or part.lower() == "nan":
            continue
        out.append(part[:-2] if part.endswith(".0") else part)
    return out


def _minutes_between(start: Any, end: Any) -> Optional[int]:
    """Room length in minutes from the TIME columns; a room past midnight wraps."""
    def seconds(value: Any) -> Optional[int]:
        if isinstance(value, timedelta):
            return int(value.total_seconds())
        if isinstance(value, time):
            return value.hour * 3600 + value.minute * 60 + value.second
        return None

    a, b = seconds(start), seconds(end)
    if a is None or b is None:
        return None
    return round(((b - a) % 86400) / 60)


def status() -> dict[str, Any]:
    """What the page can show: the detail table's span, and whether the daily table has rows."""
    span = _fetch(_RANGE_SQL)[0]
    daily = _fetch(_DAILY_RANGE_SQL)[0]
    return {
        "first_date": span["first"].isoformat() if span["first"] else None,
        "last_date": span["last"].isoformat() if span["last"] else None,
        "conferences": _int(span["conferences"]),
        "daily_table_days": _int(daily["days"]),
        "daily_table_last": daily["last"].isoformat() if daily["last"] else None,
    }


def records_for(day: date) -> list[dict[str, Any]]:
    """Every conference on one day, earliest start first."""
    rows = _fetch(_RECORDS_SQL, {"day": day})
    return [
        {
            "date": row["Call_Date"].isoformat(),
            "account_id": row["Account_ID"],
            "account_name": row["Account_Name"],
            "crn": row["CRN"],
            "conf_num": row["Conf_Num"],
            "conference_name": row["Conference_Name"],
            "pin": row["PIN"],
            "dids": _dids(row["DID"]),
            "start_time": _time(row["Start_Time"]),
            "end_time": _time(row["End_Time"]),
            "length_minutes": _minutes_between(row["Start_Time"], row["End_Time"]),
            "ringed": _int(row["Total_Ringed_Calls"]),
            "connected": _int(row["Total_Connected_Calls"]),
            "call_minutes": _int(row["Total_Call_Duration"]),
            "attended_minutes": _int(row["Total_Attended_Duration"]),
            "peak_port": _int(row["Peak_Port_Used"]),
        }
        for row in rows
    ]


_PARTY_KEYS = ("party_0", "party_1", "party_2", "party_3", "party_above_3")


def daily(end: date, days: int) -> list[dict[str, Any]]:
    """
    One line per day for the `days` up to `end`, newest first: rolled up from
    conference_summary, with conference_daily_summary's figures laid over
    the days that table has (`source` says which).
    """
    start = end - timedelta(days=days - 1)
    params = {"start": start, "end": end}
    official = {row["day"]: row for row in _fetch(_DAILY_TABLE_SQL, params)}
    out = []
    for row in _fetch(_ROLLUP_SQL, params):
        line = {
            "date": row["day"].isoformat(),
            "conferences": _int(row["conferences"]),
            "accounts": _int(row["accounts"]),
            "ringed": _int(row["ringed"]),
            "connected": _int(row["connected"]),
            "call_minutes": _int(row["call_minutes"]),
            "attended_minutes": _int(row["attended_minutes"]),
            "peak_port": _int(row["peak_port"]),
            **{key: _int(row[key]) for key in _PARTY_KEYS},
            "total_count": None,
            "acs_count": None,
            "proxy_count": None,
            "multicall_count": None,
            "source": "conference_summary",
        }
        table = official.pop(row["day"], None)
        if table:
            _overlay(line, table)
        out.append(line)
    # Days the daily table has but the detail table does not.
    for day, table in official.items():
        line = {"date": day.isoformat(), "conferences": 0, "accounts": 0, "ringed": 0, "connected": 0,
                "call_minutes": 0, "attended_minutes": 0, "peak_port": 0}
        _overlay(line, table)
        out.append(line)
    out.sort(key=lambda line: line["date"], reverse=True)
    return out


def _overlay(line: dict[str, Any], table: dict[str, Any]) -> None:
    line.update({
        "total_count": _int(table["Total_Count"]),
        "acs_count": _int(table["ACS_Count"]),
        "proxy_count": _int(table["Proxy_Count"]),
        "multicall_count": _int(table["Multicall_Count"]),
        "party_0": _int(table["Party_0"]),
        "party_1": _int(table["Party_1"]),
        "party_2": _int(table["Party_2"]),
        "party_3": _int(table["Party_3"]),
        "party_above_3": _int(table["Party_Above_3"]),
        "source": "conference_daily_summary",
    })
