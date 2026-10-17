"""
The Voicedrop Campaigns table: one row per campaign (CRN) per day, read from
the reporting team's own summary table, q100_dump.voicedrop_summary.

Unlike the rest of Campaign Metrics this does not read the parquet lake — the
summary is already computed upstream, so the page shows it as it is. One
SELECT for one day, through a dedicated connection
(VOICEDROP_SUMMARY_DATABASE_URL); nothing here ever writes.
"""

from datetime import date, time, timedelta
from functools import lru_cache
from typing import Any

from sqlalchemy import create_engine, text

from app.core.config import get_settings


class SourceNotConfigured(RuntimeError):
    """No connection to the voicedrop summary database has been configured."""


@lru_cache()
def _engine():
    url = get_settings().VOICEDROP_SUMMARY_DATABASE_URL
    if not url:
        raise SourceNotConfigured(
            "Set VOICEDROP_SUMMARY_DATABASE_URL to the q100_dump database on 192.168.0.117."
        )
    return create_engine(url, pool_pre_ping=True)


_CAMPAIGNS_SQL = text(
    """
    SELECT `Date`, Account_ID, Client_ID, Name, Start_Time, End_Time,
           Booking_Reference, CRN, PhoneNumber_Count, DND_Count, Dialout_Count,
           Blast_Count, UnBlast_Count, Connected, Not_Connected, Connected_Duration
    FROM voicedrop_summary
    WHERE `Date` = :day
    ORDER BY Start_Time, CRN
    """
)


def _time(value: Any) -> str | None:
    """MySQL TIME arrives as a timedelta through PyMySQL; show it as HH:MM:SS."""
    if value is None:
        return None
    if isinstance(value, time):
        return value.strftime("%H:%M:%S")
    if isinstance(value, timedelta):
        seconds = int(value.total_seconds())
        return f"{seconds // 3600:02d}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}"
    return str(value)


def campaigns_for(day: date) -> list[dict[str, Any]]:
    """Every campaign summarised for one day, earliest start first."""
    with _engine().connect() as connection:
        rows = connection.execute(_CAMPAIGNS_SQL, {"day": day}).mappings().all()
    return [
        {
            "date": row["Date"].isoformat() if row["Date"] else None,
            "account_id": row["Account_ID"],
            "client_id": row["Client_ID"],
            "name": row["Name"],
            "start_time": _time(row["Start_Time"]),
            "end_time": _time(row["End_Time"]),
            "booking_reference": row["Booking_Reference"],
            "crn": row["CRN"],
            "phone_number_count": row["PhoneNumber_Count"] or 0,
            "dnd_count": row["DND_Count"] or 0,
            "dialout_count": row["Dialout_Count"] or 0,
            "blast_count": row["Blast_Count"] or 0,
            "unblast_count": row["UnBlast_Count"] or 0,
            "connected": row["Connected"] or 0,
            "not_connected": row["Not_Connected"] or 0,
            "connected_duration": row["Connected_Duration"] or 0,
        }
        for row in rows
    ]
