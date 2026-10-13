"""
The Voicedrop report — one row per number dialled, per campaign, per day.

A Voicedrop campaign (CRN) dials a list of numbers, and each number may be
retried several times; the CDR holds every attempt as its own row. This tool
collapses those attempts into the list people actually ask for, using the
reporting team's own query:

    one row per CRN + CALL_DATE + CONFEREE_SEQ_NO (a number within a campaign)
    CALL_DATE, CRN
    PHONE_NUMBER    CLI for dial-in legs (CALLTYPE 0), TEL_DIGIT otherwise
    STATUS          Connected if any attempt reached the conference
    CALL_TYPE       the connected attempt's direction; Dial Out if none connected
    START_TIME      when the number first joined the conference
    DURATION_SECS   seconds in conference across the attempts, at least 1 for a
                    connected attempt
    ATTEMPTS        every attempt, retries included
    ORDER BY STATUS

Those eight columns are always there, in that order. A question that asks for
more ("with the account and disconnect reason") adds columns from EXTRA_COLUMNS
after them; the SQL for each is fixed here, so the model picks names, never
expressions.

The model may name an account, CRNs, a date, or any mix. Whatever it names, the
result says which campaigns matched — their CRNs, accounts and dates — so an
account and a day are enough to find the CRNs, and a CRN is enough to find its
account. A CRN with no date is looked for in the most recent days of the lake.

Every filter is a bound parameter. Any range up to AI_MAX_RANGE_DAYS is one
call, worked through AI_WINDOW_DAYS at a time. The model is shown exact totals
and a preview of the rows; the Excel file streams every row.
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
from app.ai.tools.metrics import _DISCONNECT_REASONS
from app.ai.tools.windows import split
from app.cdr import lake
from app.core.config import get_settings

logger = logging.getLogger(__name__)

STATUSES = ("all", "connected", "not_connected")

# Rows shown to the model. The totals are exact for the whole range, and the
# full list belongs in the file, so a preview only has to show what the rows
# look like — each phone row costs tokens.
PREVIEW_ROWS = 50
# Campaigns listed back to the model, so it can name the CRNs and accounts.
MAX_CAMPAIGNS_SHOWN = 100

_CONNECTED_ANY = "MAX(CASE WHEN INCONFERENCE IS NOT NULL THEN 1 ELSE 0 END)"
# Cast: a day where every CLI is empty can be stored as a numeric column, and
# a phone number is text either way.
_PHONE = "MAX(CASE WHEN CALLTYPE = 0 THEN CAST(CLI AS VARCHAR) ELSE CAST(TEL_DIGIT AS VARCHAR) END)"
_DURATION = (
    "SUM(CASE WHEN INCONFERENCE IS NULL THEN 0 "
    "ELSE GREATEST(DISCONNECT_DATETIME_EPOC - INCONF_DATETIME_EPOC, 1) END)"
)


def _reason_case(code: str) -> str:
    whens = " ".join(
        f"WHEN '{key}' THEN '{label.replace(chr(39), chr(39) * 2)}'"
        for key, label in _DISCONNECT_REASONS.items()
    )
    return f"CASE CAST({code} AS VARCHAR) {whens} ELSE 'Unknown' END"


# The reporting team's columns, in their order. Always present.
DEFAULT_COLUMNS: dict[str, str] = {
    "call_date": "CALL_DATE",
    "crn": "CRN",
    "phone_number": _PHONE,
    "status": f"CASE WHEN {_CONNECTED_ANY} = 1 THEN 'Connected' ELSE 'Not Connected' END",
    "call_type": (
        "CASE WHEN COALESCE(MAX(CASE WHEN INCONFERENCE IS NOT NULL THEN CALLTYPE END), 1) = 1 "
        "THEN 'Dial Out' ELSE 'Dial In' END"
    ),
    "start_time": "MIN(CAST(INCONFERENCE AS TIME))",
    "duration_secs": _DURATION,
    "attempts": "COUNT(*)",
}

# Columns a question may add. Per number (CRN + date + CONFEREE_SEQ_NO); where a
# number's attempts can differ, the last attempt's value is the one reported.
EXTRA_COLUMNS: dict[str, str] = {
    "account_id": "MAX(ACCOUNTID)",
    "conferee_seq_no": "CONFEREE_SEQ_NO",
    "conf_num": "MAX(CONF_NUM)",
    "end_time": "MAX(CASE WHEN INCONFERENCE IS NOT NULL THEN CAST(DISCONNECT_DATETIME AS TIME) END)",
    "first_attempt_time": "MIN(CAST(START_DATETIME AS TIME))",
    "last_attempt_time": "MAX(CAST(START_DATETIME AS TIME))",
    "duration_mins": f"ROUND({_DURATION} / 60.0, 2)",
    "reblasts": "MAX(CONFDIAL_REBLAST_COUNT)",
    "service_provider": "arg_max(SERVICE_PROVIDER, START_DATETIME_EPOC)",
    "location": "'L' || CAST(arg_max(LOCATION_ID, START_DATETIME_EPOC) AS VARCHAR)",
    "disconnect_reason": _reason_case("arg_max(DISCONNECT_REASON, START_DATETIME_EPOC)"),
    "dtmf_digits": "string_agg(DISTINCT NULLIF(TRIM(CAST(DTMFDIGITS AS VARCHAR)), ''), ', ')",
}

# Kept for callers that list the default shape.
COLUMNS = list(DEFAULT_COLUMNS)

VOICEDROP_REPORT_TOOL = ToolSpec(
    name="voicedrop_report",
    description=(
        "The Voicedrop phone-number report: one row per number dialled in a campaign "
        "(CRN) on a day — CALL_DATE, CRN, PHONE_NUMBER, STATUS (Connected / Not Connected "
        "across all of that number's retries), CALL_TYPE (Dial In / Dial Out), START_TIME, "
        "DURATION_SECS and ATTEMPTS (every retry). Use it for any list of Voicedrop "
        "numbers or participants — a campaign's numbers, an account's dialled numbers, "
        "who connected, who did not, how many retries a number took.\n"
        "Pass whatever identifies the campaigns, as given: account_id and a date, CRNs "
        "and a date, or CRNs alone. It finds the rest itself — the result lists every "
        "matching campaign with its CRN, account and date — so never ask the user for a "
        "CRN when you have the account, or for the account when you have the CRN. With "
        "CRNs and no date it searches the most recent days.\n"
        "columns adds columns the question asks for beyond the default eight. Any range "
        "up to a year is ONE call, processed in windows internally — never split it."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "date_from": {"type": "string", "format": "date", "description": "Inclusive, YYYY-MM-DD. Optional only when crns are given."},
            "date_to": {"type": "string", "format": "date", "description": "Inclusive, YYYY-MM-DD. Defaults to date_from."},
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
            "columns": {
                "type": "array",
                "items": {"type": "string", "enum": list(EXTRA_COLUMNS)},
                "description": "Extra columns, only when the question asks for them; added after the default eight.",
            },
        },
    },
)


def _day(value: Any, field: str) -> date | None:
    if value in (None, ""):
        return None
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


def _paths(files: list) -> str:
    """Quote discovered file paths for read_parquet([...]) — never model input."""
    return "[" + ", ".join("'" + str(p).replace("'", "''") + "'" for p in files) + "]"


class _Request:
    """A validated call: the range, the filters and the columns."""

    def __init__(self, arguments: dict[str, Any]) -> None:
        settings = get_settings()
        account = _digits(arguments.get("account_id"), "account_id")
        self.account_id = account[0] if account else None
        self.crns = _digits(arguments.get("crns") or arguments.get("crn"), "crns")
        self.phones = _phones(arguments.get("phone_numbers") or arguments.get("phone_number"))
        self.status = str(arguments.get("status") or "all").lower()
        if self.status not in STATUSES:
            raise ValueError(f"status must be one of {', '.join(STATUSES)}.")

        wanted = arguments.get("columns") or []
        if isinstance(wanted, str):
            wanted = [part.strip() for part in wanted.split(",")]
        unknown = [c for c in wanted if c and c not in EXTRA_COLUMNS and c not in DEFAULT_COLUMNS]
        if unknown:
            raise ValueError(
                f"Unknown column(s): {', '.join(unknown)}. Extra columns available: "
                f"{', '.join(EXTRA_COLUMNS)}."
            )
        self.columns = list(DEFAULT_COLUMNS) + [c for c in dict.fromkeys(wanted) if c in EXTRA_COLUMNS]

        start = _day(arguments.get("date_from"), "date_from")
        end = _day(arguments.get("date_to"), "date_to")
        # Whether the dates were found by looking the CRNs up, for the answer.
        self.located = False
        if start is None and end is None:
            if not self.crns:
                raise ValueError(
                    "Give a date or range. Only a CRN can be looked up without one; "
                    "an account needs the day it ran."
                )
            self.start = self.end = None
            self.windows: list[tuple[date, date]] = []
            return
        self.start = start or end
        self.end = end or start
        if self.end < self.start:
            raise ValueError(f"date_to ({self.end}) is before date_from ({self.start}).")
        span = (self.end - self.start).days + 1
        if span > settings.AI_MAX_RANGE_DAYS:
            raise ValueError(
                f"That range spans {span} days; the limit is {settings.AI_MAX_RANGE_DAYS}. "
                "Narrow the range."
            )
        self.windows = split(self.start, self.end, settings.AI_WINDOW_DAYS)

    def _where(self, start: date, end: date) -> tuple[list[str], list[Any]]:
        where = ["CONFEREE_TYPE = 6", "CALL_DATE BETWEEN ? AND ?"]
        params: list[Any] = [start, end]
        if self.account_id is not None:
            where.append("ACCOUNTID = ?")
            params.append(self.account_id)
        if self.crns:
            where.append(f"CRN IN ({', '.join('?' for _ in self.crns)})")
            params.extend(self.crns)
        return where, params

    def locate(self, con) -> None:
        """Find the days a CRN ran when no date was given.

        Looks through the most recent AI_DIRECT_MAX_RANGE_DAYS days the lake
        holds, newest first, and narrows the range to the days the CRNs appear.
        """
        if self.start is not None:
            return
        try:
            days = lake.available_days("cdr")
        except lake.LakeUnavailable as exc:
            raise ValueError(str(exc)) from exc
        recent = sorted(days)[-get_settings().AI_DIRECT_MAX_RANGE_DAYS:]
        if not recent:
            raise ValueError(f"No CDR export files in {lake.root('cdr')}.")
        where, params = self._where(recent[0], recent[-1])
        found = con.execute(
            f"SELECT DISTINCT CALL_DATE FROM read_parquet({_paths([days[d] for d in recent])}, "
            f"union_by_name = true) WHERE {' AND '.join(where)} ORDER BY 1",
            params,
        ).fetchall()
        if not found:
            raise ValueError(
                f"CRN {', '.join(map(str, self.crns))} does not appear in the last "
                f"{len(recent)} days of Voicedrop data ({recent[0]} to {recent[-1]}). "
                "Ask the user which day it ran."
            )
        self.start, self.end = found[0][0], found[-1][0]
        self.windows = split(self.start, self.end, get_settings().AI_WINDOW_DAYS)
        self.located = True

    def sql(self, files: list, start: date, end: date, columns: list[str] | None = None) -> tuple[str, list[Any]]:
        """The report query for one window, and its bound parameters."""
        columns = columns or self.columns
        where, params = self._where(start, end)

        having = []
        if self.status == "connected":
            having.append(f"{_CONNECTED_ANY} = 1")
        elif self.status == "not_connected":
            having.append(f"{_CONNECTED_ANY} = 0")
        if self.phones:
            having.append(f"RIGHT(CAST({_PHONE} AS VARCHAR), 10) IN ({', '.join('?' for _ in self.phones)})")
            params.extend(self.phones)

        expressions = {**DEFAULT_COLUMNS, **EXTRA_COLUMNS}
        select = ",\n               ".join(f'{expressions[c]} AS "{c}"' for c in columns)
        sql = f"""
        SELECT {select}
        FROM read_parquet({_paths(files)}, union_by_name = true)
        WHERE {' AND '.join(where)}
        GROUP BY CRN, CALL_DATE, CONFEREE_SEQ_NO
        {('HAVING ' + ' AND '.join(having)) if having else ''}
        ORDER BY "status", CRN, CONFEREE_SEQ_NO"""
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
    """Exact totals over the whole range, the campaigns matched, and a preview."""
    try:
        request = _Request(arguments)
    except ValueError as exc:
        return (str(exc), True)

    preview_cap = min(PREVIEW_ROWS, get_settings().AI_MAX_ROWS_TO_MODEL)
    preview: list[dict[str, Any]] = []
    totals = {"numbers": 0, "connected": 0, "not_connected": 0, "duration_secs": 0, "attempts": 0}
    campaigns: list[dict[str, Any]] = []
    windows_read = 0
    started = perf_counter()
    # The summary needs the account and the default figures whatever columns
    # the file shows.
    summary_columns = list(dict.fromkeys(list(DEFAULT_COLUMNS) + ["account_id"]))

    try:
        with connect() as con:
            request.locate(con)
            for start, end, files in request.windows_with_files():
                windows_read += 1
                inner, params = request.sql(files, start, end, summary_columns)
                # Per campaign, in SQL — a month of numbers is far too many rows
                # to add up in Python.
                for crn, call_date, account, numbers, connected, seconds, attempts in con.execute(
                    f"""SELECT crn, call_date, MAX(account_id), COUNT(*),
                               COUNT(*) FILTER (WHERE status = 'Connected'),
                               COALESCE(SUM(duration_secs), 0), COALESCE(SUM(attempts), 0)
                        FROM ({inner}) r
                        GROUP BY crn, call_date ORDER BY call_date, crn""",
                    params,
                ).fetchall():
                    totals["numbers"] += numbers
                    totals["connected"] += connected
                    totals["duration_secs"] += int(seconds)
                    totals["attempts"] += int(attempts)
                    campaigns.append({
                        "crn": crn,
                        "call_date": call_date,
                        "account_id": account,
                        "numbers": numbers,
                        "connected": connected,
                        "not_connected": numbers - connected,
                    })
                if len(preview) < preview_cap and campaigns:
                    sql, params = request.sql(files, start, end)
                    cursor = con.execute(f"{sql} LIMIT {preview_cap - len(preview)}", params)
                    preview += [dict(zip(request.columns, row)) for row in cursor.fetchall()]
    except ValueError as exc:
        return (str(exc), True)
    except duckdb.Error as exc:
        logger.error(f"voicedrop_report failed: {exc}")
        return (f"The report query failed: {exc}", True)

    totals["not_connected"] = totals["numbers"] - totals["connected"]
    logger.info(
        f"AI voicedrop_report {request.describe()} | windows={windows_read}/{len(request.windows)} "
        f"campaigns={len(campaigns)} numbers={totals['numbers']} seconds={perf_counter() - started:.1f}"
    )

    if not windows_read:
        return (
            f"No CDR export files for {request.start} to {request.end} in {lake.root('cdr')}. "
            "Try a different date range.",
            True,
        )
    if not totals["numbers"]:
        return (f"0 numbers. No Voicedrop calls matched {request.describe()}.", False)

    accounts = sorted({c["account_id"] for c in campaigns if c["account_id"] is not None})
    notes: list[str] = []
    if request.located:
        notes.append(
            f"No date was given; the CRNs were found on {request.start}"
            + (f" to {request.end}" if request.end != request.start else "")
            + "."
        )
    if request.account_id is None and accounts:
        notes.append(f"Account(s) for these campaigns: {', '.join(map(str, accounts))}.")
    if not request.crns:
        notes.append(f"CRN(s) found: {', '.join(str(c['crn']) for c in campaigns[:MAX_CAMPAIGNS_SHOWN])}.")
    if len(request.windows) > 1:
        notes.append(f"Worked through {len(request.windows)} windows of up to {get_settings().AI_WINDOW_DAYS} days.")

    payload: dict[str, Any] = {
        "date_from": request.start.isoformat(),
        "date_to": request.end.isoformat(),
        "filters": request.describe(),
        "columns": [c.upper() for c in request.columns],
        "totals": {**totals, "campaigns": len(campaigns), "accounts": accounts},
        "campaigns": campaigns[:MAX_CAMPAIGNS_SHOWN],
        "row_count": totals["numbers"],
        "rows": preview,
        "notes": notes,
    }
    if len(campaigns) > MAX_CAMPAIGNS_SHOWN:
        payload["campaigns_truncated"] = f"First {MAX_CAMPAIGNS_SHOWN} of {len(campaigns)} campaigns listed."
    if totals["numbers"] > len(preview):
        payload["truncated"] = True
        payload["note"] = (
            f"The totals cover all {totals['numbers']:,} numbers; the rows are a preview of the "
            f"first {len(preview)}. The full list goes into the Excel file."
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
        try:
            request.locate(con)
        except (ValueError, duckdb.Error) as exc:
            raise ExportUnavailable(str(exc)) from exc

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
            columns=list(request.columns),
            headers=[c.upper() for c in request.columns],
            batches=batches(),
            cap=max_rows,
            description=f"voicedrop_report | {request.describe()}",
        )
