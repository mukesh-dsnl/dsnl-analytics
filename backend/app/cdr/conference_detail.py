"""
One conference room in full — the details panel on Conference › Campaign
Metrics › Campaigns.

A room is one (CRN, CONF_NUM) on one day. Its booking comes from that day's
CODR export (codr_YYYYMMDD.parquet): account, client, name, times, chair PIN.
What happened in it comes from the same day's CDR export: the DIDs callers
dialled in on, and every chairperson leg (CONFEREE_TYPE = 1).

A chairperson often joins more than once (a dropped line, a second device), so
the legs are folded into one line per name and number, with how many times
they came in and whether any of those reached the room.

The number is CLI or TEL_DIGIT, whichever the leg has. The dictionary puts a
dial-in's number in CLI and a dial-out's in TEL_DIGIT, but chair legs marked
dial-in (CALLTYPE 1) carry it in TEL_DIGIT on the live exports, so each leg is
read the way its call type says first, then the other column.

Read-only: SELECTs against the parquet files in place.
"""

import logging
from datetime import date, datetime, time
from typing import Any, Optional

import duckdb

from app.cdr import directory, lake
from app.cdr.campaign_service import DatasetNotReady, _sql_list

logger = logging.getLogger(__name__)

_ROOM_SQL = """
SELECT
    co.ACCOUNT_ID,
    co.ACCOUNT_NAME,
    co.CLIENT_ID,
    co.CLIENT_NAME,
    co.CONFERENCE_NAME,
    CAST(co.START_DATETIME AS DATE) AS call_date,
    CAST(co.START_DATETIME AS TIME) AS start_time,
    CAST(co.END_DATETIME AS TIME) AS end_time,
    CEIL((co.END_DATETIME_EPOC - co.START_DATETIME_EPOC) / 60) AS room_duration_mins,
    co.CRN,
    co.CONF_NUM,
    co.CHAIR_PIN,
    co.CHAIR_NAME
FROM read_parquet({files}) co
WHERE CAST(co.START_DATETIME AS DATE) = ?
  AND co.ACCOUNT_ID = ?
  AND co.CRN = ?
  AND CAST(co.CONF_NUM AS VARCHAR) = ?
LIMIT 1
"""

_DIDS_SQL = """
SELECT DISTINCT CAST(DID AS BIGINT) AS did
FROM read_parquet({files})
WHERE CRN = ? AND CAST(CONF_NUM AS VARCHAR) = ? AND DID IS NOT NULL AND DID > 0
ORDER BY did
"""

_CHAIRS_SQL = """
WITH legs AS (
    SELECT
        NULLIF(TRIM(CONFEREE_NAME), '') AS name,
        CASE WHEN CALLTYPE = 1
             THEN COALESCE(NULLIF(TRIM(CLI), ''), NULLIF(TRIM(TEL_DIGIT), ''))
             ELSE COALESCE(NULLIF(TRIM(TEL_DIGIT), ''), NULLIF(TRIM(CLI), ''))
        END AS phone,
        START_DATETIME,
        INCONFERENCE
    FROM read_parquet({files})
    WHERE CRN = ? AND CAST(CONF_NUM AS VARCHAR) = ? AND CONFEREE_TYPE = 1
)
SELECT
    name,
    phone,
    COUNT(*) AS legs,
    COUNT(INCONFERENCE) > 0 AS joined,
    CAST(MIN(START_DATETIME) AS TIME) AS first_call
FROM legs
GROUP BY name, phone
ORDER BY MIN(START_DATETIME)
"""


def _day_file(kind: lake.Kind, day: date) -> list:
    try:
        files = lake.files_for_range(kind, day, day)
    except lake.LakeUnavailable as exc:
        raise DatasetNotReady(str(exc)) from exc
    if not files:
        raise DatasetNotReady(f"No {kind.upper()} export file for {day} in {lake.root(kind)}.")
    return files


def _clock(value: Any) -> Optional[str]:
    if isinstance(value, (time, datetime)):
        return value.strftime("%H:%M:%S")
    return str(value) if value is not None else None


def _query(con: duckdb.DuckDBPyConnection, sql: str, params: list[Any]) -> list[dict[str, Any]]:
    cursor = con.execute(sql, params)
    columns = [d[0] for d in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def detail(day: date, account_id: int, crn: int, conf_num: str) -> Optional[dict[str, Any]]:
    """The room's booking, DIDs and chairpersons; None when CODR has no such room that day."""
    codr_files = _day_file("codr", day)
    try:
        with duckdb.connect() as con:
            rooms = _query(con, _ROOM_SQL.format(files=_sql_list(codr_files)), [day, account_id, crn, conf_num])
            if not rooms:
                return None
            room = rooms[0]
            # The CDR side is a bonus: a missing CDR export still shows the booking.
            try:
                cdr_files = _day_file("cdr", day)
            except DatasetNotReady as exc:
                logger.warning(f"Conference detail without CDR: {exc}")
                dids, chairs, cdr_note = [], [], str(exc)
            else:
                params = [crn, conf_num]
                dids = [r["did"] for r in _query(con, _DIDS_SQL.format(files=_sql_list(cdr_files)), params)]
                chairs = _query(con, _CHAIRS_SQL.format(files=_sql_list(cdr_files)), params)
                cdr_note = None
    except duckdb.Error as exc:
        logger.error(f"Conference detail query failed: {exc}")
        raise DatasetNotReady(f"Query failed against the lake: {exc}") from exc

    client_id = room["CLIENT_ID"]
    duration = room["room_duration_mins"]
    return {
        "date": room["call_date"].isoformat() if room["call_date"] else day.isoformat(),
        "account_id": room["ACCOUNT_ID"],
        # The master list's name first, as everywhere else in the app; CODR's as the fallback.
        "account_name": directory.account_name(account_id) or room["ACCOUNT_NAME"],
        "client_id": client_id,
        "client_name": (directory.clients().get(client_id) if client_id is not None else None) or room["CLIENT_NAME"],
        "conference_name": room["CONFERENCE_NAME"],
        "start_time": _clock(room["start_time"]),
        "end_time": _clock(room["end_time"]),
        "room_duration_mins": int(duration) if duration is not None and duration >= 0 else None,
        "crn": room["CRN"],
        "conf_num": str(room["CONF_NUM"]),
        "chair_pin": room["CHAIR_PIN"],
        "chair_name": room["CHAIR_NAME"],
        "dids": dids,
        "chairpersons": [
            {
                "name": c["name"],
                "phone": c["phone"],
                "legs": c["legs"],
                "joined": bool(c["joined"]),
                "first_call": _clock(c["first_call"]),
            }
            for c in chairs
        ],
        "cdr_note": cdr_note,
    }
