"""
The Voicedrop report — one row per number dialled, per campaign, per day.

A Voicedrop campaign (CRN) dials a list of numbers, and each number may be
retried several times; the CDR holds every attempt as its own row. This tool
collapses those attempts into the list people actually ask for — "which
numbers in this campaign connected, and for how long" — using the reporting
team's own query, unchanged in substance:

    one row per CRN + CALL_DATE + CONFEREE_SEQ_NO (a number within a campaign)
    PHONE_NUMBER          CLI for dial-in legs (CALLTYPE 0), TEL_DIGIT otherwise
    STATUS                Connected if any attempt reached the conference
    TOTAL_DURATION_SECS   seconds in conference across the attempts, at least
                          1 for a connected attempt
    TOTAL_ATTEMPTS        every attempt, retries included

The SQL is fixed and every filter is a bound parameter: the model chooses the
filters, never the query. Any range up to AI_MAX_RANGE_DAYS is one call — it is
worked through AI_WINDOW_DAYS at a time, so a month of campaigns is read a few
days at a time rather than all at once. The model is shown exact totals for the
whole range and a preview of the rows; /csv and /excel stream every row.
"""

import json
import logging
from contextlib import contextmanager
from datetime import date, datetime
from time import perf_counter
from typing import Any, Iterator

import duckdb

from app.ai.providers.base import ToolSpec
from app.ai.tools.export_source import EXPORT_BATCH, ExportData, ExportUnavailable, connect
from app.ai.tools.windows import split
from app.cdr import lake
from app.core.config import get_settings

logger = logging.getLogger(__name__)

STATUSES = ("all", "connected", "not_connected")

# Rows shown to the model. The totals are exact for the whole range, and the
# full list belongs in a file, so a preview only has to show what the rows look
# like — each phone row costs tokens, and 500 of them cost ~30k per question.
PREVIEW_ROWS = 50

VOICEDROP_REPORT_TOOL = ToolSpec(
    name="voicedrop_report",
    description=(
        "The Voicedrop phone-number report: one row per number dialled in a campaign "
        "(CRN) on a day, with phone_number, status (Connected / Not Connected across "
        "all of that number's retries), total_duration_secs and total_attempts (every "
        "retry). Use it for any list of Voicedrop numbers — a campaign's participants, "
        "an account's dialled numbers, who connected, who did not, how many retries a "
        "number took. Filter by account_id, crns, phone_numbers and status. Returns "
        "exact totals for the whole range plus a preview of the rows. Any range up to "
        "a year is ONE call: it is processed in windows internally — never split a "
        "range into several calls yourself."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "date_from": {"type": "string", "format": "date", "description": "Inclusive, YYYY-MM-DD."},
            "date_to": {"type": "string", "format": "date", "description": "Inclusive, YYYY-MM-DD."},
            "account_id": {"type": "string", "description": "Restrict to one ACCOUNTID."},
            "crns": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Restrict to these campaign CRNs.",
            },
            "phone_numbers": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Restrict to these numbers (matched on their last 10 digits).",
            },
            "status": {
                "type": "string",
                "enum": list(STATUSES),
                "description": "Only connected numbers, only not-connected ones, or all (default).",
            },
        },
        "required": ["date_from", "date_to"],
    },
)

_CONNECTED_ANY = "MAX(CASE WHEN INCONFERENCE IS NOT NULL THEN 1 ELSE 0 END)"
# Cast: a day where every CLI is empty can be stored as a numeric column, and
# a phone number is text either way.
_PHONE = "MAX(CASE WHEN CALLTYPE = 0 THEN CAST(CLI AS VARCHAR) ELSE CAST(TEL_DIGIT AS VARCHAR) END)"

COLUMNS = ["crn", "call_date", "phone_number", "status", "total_duration_secs", "total_attempts"]


def _day(value: Any, field: str) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value).strip()[:10])
    except (ValueError, TypeError) as exc:
        raise ValueError(f"{field} must be a date as YYYY-MM-DD, not {value!r}.") from exc


def _digits(values: Any, field: str) -> list[int]:
    if values in (None, "", []):
        return []
    if isinstance(values, (str, int)):
        values = str(values).replace(";", ",").split(",")
    out = []
    for value in values:
        text = str(value).strip()
        if not text:
            continue
        if not text.isdigit():
            raise ValueError(f"{field} must be numbers; {text!r} is not.")
        out.append(int(text))
    return out


def _phones(values: Any) -> list[str]:
    if values in (None, "", []):
        return []
    if isinstance(values, str):
        values = values.replace(";", ",").split(",")
    phones = []
    for value in values:
        digits = "".join(ch for ch in str(value) if ch.isdigit())
        if digits:
            phones.append(digits[-10:])
    return phones


class _Request:
    """A validated call: the range and the filters, ready to run in windows."""

    def __init__(self, arguments: dict[str, Any]) -> None:
        settings = get_settings()
        self.start = _day(arguments.get("date_from"), "date_from")
        self.end = _day(arguments.get("date_to"), "date_to")
        if self.end < self.start:
            raise ValueError(f"date_to ({self.end}) is before date_from ({self.start}).")
        span = (self.end - self.start).days + 1
        if span > settings.AI_MAX_RANGE_DAYS:
            raise ValueError(
                f"That range spans {span} days; the limit is {settings.AI_MAX_RANGE_DAYS}. "
                "Narrow the range."
            )
        account = _digits(arguments.get("account_id"), "account_id")
        self.account_id = account[0] if account else None
        self.crns = _digits(arguments.get("crns") or arguments.get("crn"), "crns")
        self.phones = _phones(arguments.get("phone_numbers") or arguments.get("phone_number"))
        self.status = str(arguments.get("status") or "all").lower()
        if self.status not in STATUSES:
            raise ValueError(f"status must be one of {', '.join(STATUSES)}.")
        self.windows = split(self.start, self.end, settings.AI_WINDOW_DAYS)

    def sql(self, files: list, start: date, end: date) -> tuple[str, list[Any]]:
        """The report query for one window, and its bound parameters."""
        paths = "[" + ", ".join("'" + str(p).replace("'", "''") + "'" for p in files) + "]"
        where = ["CONFEREE_TYPE = 6", "CALL_DATE BETWEEN ? AND ?"]
        params: list[Any] = [start, end]
        if self.account_id is not None:
            where.append("ACCOUNTID = ?")
            params.append(self.account_id)
        if self.crns:
            where.append(f"CRN IN ({', '.join('?' for _ in self.crns)})")
            params.extend(self.crns)

        having = []
        if self.status == "connected":
            having.append(f"{_CONNECTED_ANY} = 1")
        elif self.status == "not_connected":
            having.append(f"{_CONNECTED_ANY} = 0")
        if self.phones:
            having.append(f"RIGHT(CAST({_PHONE} AS VARCHAR), 10) IN ({', '.join('?' for _ in self.phones)})")
            params.extend(self.phones)

        sql = f"""
        SELECT CRN AS crn,
               CALL_DATE AS call_date,
               {_PHONE} AS phone_number,
               CASE WHEN {_CONNECTED_ANY} = 1 THEN 'Connected' ELSE 'Not Connected' END AS status,
               SUM(CASE WHEN INCONFERENCE IS NULL THEN 0
                        ELSE GREATEST(DISCONNECT_DATETIME_EPOC - INCONF_DATETIME_EPOC, 1) END)
                   AS total_duration_secs,
               COUNT(*) AS total_attempts
        FROM read_parquet({paths}, union_by_name = true)
        WHERE {' AND '.join(where)}
        GROUP BY CRN, CALL_DATE, CONFEREE_SEQ_NO
        {('HAVING ' + ' AND '.join(having)) if having else ''}
        ORDER BY CRN, CONFEREE_SEQ_NO"""
        return sql, params

    def windows_with_files(self) -> Iterator[tuple[date, date, list]]:
        for start, end in self.windows:
            try:
                files = lake.files_for_range("cdr", start, end)
            except lake.LakeUnavailable as exc:
                raise ValueError(str(exc)) from exc
            if files:
                yield start, end, files

    def describe(self) -> str:
        parts = [f"{self.start} to {self.end}"]
        if self.account_id is not None:
            parts.append(f"account {self.account_id}")
        if self.crns:
            parts.append(f"CRNs {', '.join(map(str, self.crns[:10]))}" + (" …" if len(self.crns) > 10 else ""))
        if self.phones:
            parts.append(f"{len(self.phones)} phone number(s)")
        if self.status != "all":
            parts.append(self.status.replace("_", " "))
        return " | ".join(parts)


def voicedrop_report(**arguments: Any) -> tuple[str, bool]:
    """Exact totals over the whole range, and a preview of the rows."""
    try:
        request = _Request(arguments)
    except ValueError as exc:
        return (str(exc), True)

    preview_cap = min(PREVIEW_ROWS, get_settings().AI_MAX_ROWS_TO_MODEL)
    preview: list[dict[str, Any]] = []
    totals = {"numbers": 0, "connected": 0, "not_connected": 0, "total_duration_secs": 0, "total_attempts": 0}
    crns: set[int] = set()
    windows_read = 0
    started = perf_counter()

    try:
        with connect() as con:
            for start, end, files in request.windows_with_files():
                windows_read += 1
                sql, params = request.sql(files, start, end)
                # Totals for the whole window in SQL — a month of campaigns is
                # far too many rows to add up in Python.
                summary = con.execute(
                    f"""SELECT COUNT(*),
                               COUNT(*) FILTER (WHERE status = 'Connected'),
                               COALESCE(SUM(total_duration_secs), 0),
                               COALESCE(SUM(total_attempts), 0),
                               LIST(DISTINCT crn)
                        FROM ({sql}) r""",
                    params,
                ).fetchone()
                totals["numbers"] += summary[0]
                totals["connected"] += summary[1]
                totals["total_duration_secs"] += int(summary[2])
                totals["total_attempts"] += int(summary[3])
                crns.update(summary[4] or [])
                if len(preview) < preview_cap and summary[0]:
                    cursor = con.execute(f"{sql} LIMIT {preview_cap - len(preview)}", params)
                    preview += [dict(zip(COLUMNS, row)) for row in cursor.fetchall()]
    except ValueError as exc:
        return (str(exc), True)
    except duckdb.Error as exc:
        logger.error(f"voicedrop_report failed: {exc}")
        return (f"The report query failed: {exc}", True)

    totals["not_connected"] = totals["numbers"] - totals["connected"]
    logger.info(
        f"AI voicedrop_report {request.describe()} | windows={windows_read}/{len(request.windows)} "
        f"numbers={totals['numbers']} seconds={perf_counter() - started:.1f}"
    )

    if not windows_read:
        return (
            f"No CDR export files for {request.start} to {request.end} in {lake.root('cdr')}. "
            "Try a different date range.",
            True,
        )
    if not totals["numbers"]:
        return ("0 numbers. The filters matched no Voicedrop calls in this range.", False)

    payload: dict[str, Any] = {
        "date_from": request.start.isoformat(),
        "date_to": request.end.isoformat(),
        "filters": request.describe(),
        "totals": {**totals, "campaigns": len(crns)},
        "row_count": totals["numbers"],
        "rows": preview,
    }
    if len(request.windows) > 1:
        payload["notes"] = [f"Worked through {len(request.windows)} windows of up to {get_settings().AI_WINDOW_DAYS} days."]
    if totals["numbers"] > len(preview):
        payload["truncated"] = True
        payload["note"] = (
            f"The totals cover all {totals['numbers']:,} numbers; the rows are a preview of the "
            f"first {len(preview)}. The full list goes into a /csv or /excel file."
        )
    return (json.dumps(payload, default=str), False)


@contextmanager
def export_rows(arguments: dict[str, Any], max_rows: int) -> Iterator[ExportData]:
    """Every row of the report, window by window, straight to the file."""
    try:
        request = _Request(dict(arguments))
    except ValueError as exc:
        raise ExportUnavailable(str(exc)) from exc

    with connect() as con:

        def batches() -> Iterator[list[tuple]]:
            remaining = max_rows
            for start, end, files in request.windows_with_files():
                sql, params = request.sql(files, start, end)
                cursor = con.execute(f"{sql} LIMIT {remaining}", params)
                while remaining > 0 and (chunk := cursor.fetchmany(min(EXPORT_BATCH, remaining))):
                    remaining -= len(chunk)
                    yield chunk
                if remaining <= 0:
                    return

        yield ExportData(
            columns=list(COLUMNS),
            batches=batches(),
            cap=max_rows,
            description=f"voicedrop_report | {request.describe()}",
        )
