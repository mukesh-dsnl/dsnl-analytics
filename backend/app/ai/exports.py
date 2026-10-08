"""
/csv and /excel: the full data behind an answer, as a downloadable file.

The model only ever reads a capped slice of a result (AI_MAX_ROWS_TO_MODEL),
and the chat shows less still. The file is for the rest of it: after the answer
is saved, the answer's final data query is run again without that cap (up to
AI_EXPORT_MAX_ROWS) and streamed straight to disk. The rows never pass through
the model, so the file is exact and costs no tokens.

The file holds only the data that was asked for: one table, readable column
headers, nothing else — no notes sheet, no sheets for the exploratory calls
the model made on the way. In Excel that is a single "Data" sheet with the
header row bold and frozen, numbers as numbers, and identifiers (phones, CRNs,
account ids) as text so Excel neither drops leading zeros nor shows them as
9.84E+11. The CSV holds the same rows.

Both formats are written in one pass, so /csv /excel together run the query
once. Files are written under a temporary name and renamed into place when
complete, so a crash leaves no half file a download could serve.
"""

from __future__ import annotations

import csv
import json
import logging
import os
import re
import uuid
from datetime import date, datetime, time, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable, Iterator

from sqlalchemy.orm import Session

from app.ai.tools import ad_hoc_sql, metrics, structured, voicedrop_report
from app.ai.tools.export_source import ExportData, ExportUnavailable
from app.core.config import get_settings
from app.models.conversation import (
    EXPORT_FAILED,
    EXPORT_PENDING,
    EXPORT_READY,
    Message,
    MessageExport,
)

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[2]

# Excel's own ceiling: 1,048,576 rows a sheet, one of them the header.
EXCEL_MAX_ROWS = 1_048_575

EXPORTERS: dict[str, Callable[[dict[str, Any], int], Any]] = {
    "query_metrics": metrics.export_rows,
    "run_cdr_query": ad_hoc_sql.export_rows,
    "get_cdr_panel": structured.export_rows,
    "voicedrop_report": voicedrop_report.export_rows,
}

# Columns that hold identifiers, not quantities: written as text in Excel.
_ID_COLUMN = re.compile(
    r"(phone|mobile|msisdn|ani|dnis|did|crn|conf_?num|pin|account|client|booking|"
    r"billing|reg_?num|code|(^|_)id$|^id$)",
    re.IGNORECASE,
)
# Acronyms kept upright in headers instead of being title-cased.
_ACRONYMS = {"id", "crn", "dtmf", "isd", "pin", "did", "ani", "dnis", "csv", "sip", "ivr", "utc", "cli", "pcs"}

# Raw CDR/CODR columns whose plain title-casing would read badly — named as in
# the CDR/CODR data dictionaries (local_reports/SQL/*_data_dictionary.md).
_HEADER_NAMES = {
    "accountid": "Account ID",
    "clientid": "Client ID",
    "conf_num": "Conference Number",
    "sync_conf_num": "Sync Conference Number",
    "tel_digit": "Phone (Dial Out)",
    "cli": "Phone (Dial In)",
    "inconf_datetime": "In-Conference Time",
    "start_datetime": "Start Time",
    "end_datetime": "End Time",
    "disconnect_datetime": "Disconnect Time",
    "release_datetime": "Release Time",
    "conferee_type": "Conferee Type",
    "module_type": "Module Type",
    "location_id": "Location ID",
    "e_record_id": "E-Record ID",
    "confdial_reblast_count": "Conference Dial Reblast Count",
    "diallist_reblast_count": "Dial List Reblast Count",
    "aid_count": "AID Count",
}


# ── Paths ───────────────────────────────────────────────────────────────


def export_dir() -> Path:
    path = Path(get_settings().AI_EXPORT_DIR)
    return path if path.is_absolute() else BACKEND_DIR / path


def resolve(export: MessageExport) -> Path | None:
    """The file on disk for a stored export, refusing anything outside the
    export directory — the path came from our own row, but a download must
    never be able to read elsewhere even if that row were tampered with."""
    if not export.file_path:
        return None
    root = export_dir().resolve()
    path = (root / export.file_path).resolve()
    if root not in path.parents:
        return None
    return path


# ── Values and headers ──────────────────────────────────────────────────


def header(name: str) -> str:
    """A column name as a readable header.

    `total_minutes` → "Total Minutes", `ACCOUNTID` → "Account ID", `crn` → "CRN",
    `START_DATETIME_EPOC` → "Start Time (Epoch)", `connect_rate_pct` → "Connect Rate %".
    """
    raw = str(name).strip()
    key = raw.lower()
    suffix = ""
    if key.endswith("_epoc") or key.endswith("_epoch"):
        key, suffix = key.rsplit("_", 1)[0], " (Epoch)"
    if key in _HEADER_NAMES:
        return _HEADER_NAMES[key] + suffix
    words = [w for w in re.split(r"[_\s]+", key) if w]
    if not words:
        return raw
    if words[-1] == "pct":
        words[-1] = "%"
    return " ".join(w.upper() if w in _ACRONYMS else w.capitalize() for w in words) + suffix


def _is_id(column: str) -> bool:
    return bool(_ID_COLUMN.search(column))


def _plain(value: Any) -> Any:
    """A database value as something both writers accept."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value).hex()
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, default=str)
    return value


def _excel_value(value: Any, as_text: bool) -> Any:
    value = _plain(value)
    if value is None:
        return None
    if as_text and not isinstance(value, str):
        return str(value)
    if isinstance(value, datetime) and value.tzinfo is not None:
        # Excel has no time zones; keep the wall-clock time the data shows.
        return value.replace(tzinfo=None)
    if isinstance(value, str) and len(value) > 32_000:
        return value[:32_000]  # Excel's per-cell limit is 32,767 characters
    return value


def _csv_value(value: Any) -> Any:
    value = _plain(value)
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat(sep=" ")
    if isinstance(value, (date, time)):
        return value.isoformat()
    return value


def _slug(text: str, limit: int = 50) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return (slug[:limit].rstrip("-") or "ai-export")


def _sheet_title(text: str, used: set[str]) -> str:
    base = re.sub(r"[\[\]:*?/\\]", " ", text).strip()[:28] or "Data"
    title, n = base, 2
    while title.lower() in used:
        title = f"{base[:25]} {n}"
        n += 1
    used.add(title.lower())
    return title


# ── Which tool calls to export ──────────────────────────────────────────

# A LIMIT at the very end of a statement is the outermost one: anything inside
# a subquery or CTE is followed by its closing parenthesis.
_TRAILING_LIMIT = re.compile(r"\s+limit\s+(\d+)\s*;?\s*$", re.IGNORECASE)


_MONTH = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?"
# Dates in a question — "oct 10", "10th", "10 october", "2026-10-10", "10/10" —
# whose numbers are days, not row counts.
_DATES = re.compile(
    rf"{_MONTH}\s*\d{{1,2}}(?:\s*(?:,|-|to|and|&)\s*\d{{1,2}})*|\d{{1,2}}\s*{_MONTH}"
    r"|\d{1,2}(?:st|nd|rd|th)\b|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?",
    re.IGNORECASE,
)


def _asked_for(count: int, question: str) -> bool:
    """Whether the question itself names this many rows ("top 10", "first 50").

    Dates are taken out first, so "oct 10" does not read as asking for ten.
    """
    text = _DATES.sub(" ", question or "")
    return bool(re.search(rf"(?<![\d.]){count}(?![\d.])", text))


def full_arguments(call: dict[str, Any], question: str) -> tuple[dict[str, Any], str | None]:
    """The call's arguments for the file, with any row limit the user did not ask for removed.

    The model sometimes caps a query to keep its own chat preview short — a
    `LIMIT 20` it then shows as twenty rows. That cap belongs to the preview,
    not to the data: a file limited to it is exactly the partial result the
    export exists to avoid. A limit the question names ("top 10 accounts")
    is the answer itself and is kept.

    Returns (arguments, note) — the note says what was removed, for the file.
    """
    arguments = dict(call.get("input") or {})
    tool = call.get("tool")

    if tool == "run_cdr_query":
        sql = str(arguments.get("sql") or "")
        match = _TRAILING_LIMIT.search(sql)
        if match and not _asked_for(int(match.group(1)), question):
            arguments["sql"] = sql[: match.start()]
            return arguments, f"The query's LIMIT {match.group(1)} was a chat preview limit and was removed, so every row is included."

    if tool == "query_metrics" and arguments.get("limit") is not None:
        try:
            limit = int(arguments["limit"])
        except (TypeError, ValueError):
            limit = None
        if limit is not None and not _asked_for(limit, question):
            arguments.pop("limit")
            return arguments, f"The limit of {limit} rows was a chat preview limit and was removed, so every row is included."

    return arguments, None



def sources(queries: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """The answer's successful data calls, in order, without exact repeats."""
    chosen: list[dict[str, Any]] = []
    seen: set[str] = set()
    for query in queries or []:
        if query.get("error") or query.get("tool") not in EXPORTERS:
            continue
        key = json.dumps([query.get("tool"), query.get("input")], sort_keys=True, default=str)
        if key in seen:
            continue
        seen.add(key)
        chosen.append(query)
    return chosen


# ── Rows and records ────────────────────────────────────────────────────


def create_pending(db: Session, message: Message, formats: list[str], user_id: str | None) -> list[MessageExport]:
    """One pending row per requested format, before any work starts — so a
    page that reloads mid-export knows a file is on its way."""
    rows = []
    for fmt in dict.fromkeys(formats):
        row = MessageExport(
            message_id=message.id,
            conversation_id=message.conversation_id,
            user_id=user_id,
            format=fmt,
            status=EXPORT_PENDING,
        )
        db.add(row)
        rows.append(row)
    db.flush()
    return rows


def serialize(export: MessageExport) -> dict[str, Any]:
    return {
        "id": export.id,
        "format": export.format,
        "status": export.status,
        "file_name": export.file_name,
        "row_count": export.row_count or 0,
        "sheet_count": export.sheet_count or 0,
        "size_bytes": export.size_bytes or 0,
        "truncated": bool(export.truncated),
        "error": export.error,
        "download_url": f"/api/ai/exports/{export.id}/download" if export.status == EXPORT_READY else None,
    }


# ── Writing ─────────────────────────────────────────────────────────────


class _Sheet:
    """One streaming (write-only) worksheet: rows go to disk as they arrive."""

    def __init__(self, data: ExportData, sample: list[tuple]) -> None:
        from openpyxl import Workbook
        from openpyxl.cell import WriteOnlyCell
        from openpyxl.styles import Font
        from openpyxl.utils import get_column_letter

        self.book = Workbook(write_only=True)
        self.sheet = self.book.create_sheet("Data")
        self.as_text = [_is_id(c) for c in data.columns]
        self.rows = 0
        self.capped = False

        names = [header(c) for c in data.columns]
        # Widths from the header and the first batch — a write-only sheet has
        # to be told before its first row, and the first batch is a fair sample.
        for index, name in enumerate(names):
            lengths = [len(str(row[index])) for row in sample[:500] if row[index] is not None]
            width = min(max([len(name), *lengths]) + 2, 60)
            self.sheet.column_dimensions[get_column_letter(index + 1)].width = width
        self.sheet.freeze_panes = "A2"

        cells = []
        for name in names:
            cell = WriteOnlyCell(self.sheet, value=name)
            cell.font = Font(bold=True)
            cells.append(cell)
        self.sheet.append(cells)

    def write(self, batch: list[tuple]) -> None:
        for row in batch:
            if self.rows >= EXCEL_MAX_ROWS:
                self.capped = True
                return
            self.sheet.append([_excel_value(v, t) for v, t in zip(row, self.as_text)])
            self.rows += 1

    def save(self, path: Path) -> None:
        self.book.save(path)


def _chain(first: list[tuple], rest: Iterator[list[tuple]]) -> Iterator[list[tuple]]:
    if first:
        yield first
    yield from rest


def _write(data: ExportData, parts: dict[str, Path]) -> dict[str, tuple[int, bool]]:
    """Stream one result into every requested format at once.

    Returns {format: (rows written, may be incomplete)}. One pass over the
    rows, so /csv /excel together still run the query only once.
    """
    batches = iter(data.batches)
    first = next(batches, [])
    sheet = _Sheet(data, first) if "xlsx" in parts else None
    csv_rows = 0

    handle = parts["csv"].open("w", encoding="utf-8-sig", newline="") if "csv" in parts else None
    try:
        # utf-8-sig: the byte-order mark is what makes Excel open UTF-8 correctly.
        writer = csv.writer(handle) if handle else None
        if writer:
            writer.writerow([header(c) for c in data.columns])
        for batch in _chain(first, batches):
            if writer:
                writer.writerows([_csv_value(v) for v in row] for row in batch)
                csv_rows += len(batch)
            if sheet:
                sheet.write(batch)
    finally:
        if handle:
            handle.close()

    written: dict[str, tuple[int, bool]] = {}
    if sheet:
        sheet.save(parts["xlsx"])
        written["xlsx"] = (sheet.rows, sheet.capped or sheet.rows >= data.cap)
    if handle:
        written["csv"] = (csv_rows, csv_rows >= data.cap)
    return written


def build(db: Session, message: Message, exports: list[MessageExport], question: str) -> None:
    """Produce every pending file for one answer, then record the outcome.

    The file holds the data the question asked for and nothing else: one
    table — the answer's final data query, which is the result the answer is
    built on — under readable column headers. Earlier calls in the same answer
    are the model finding its way there and are left out; one of them is used
    only if the final query can no longer be re-run.

    Never raises: a failed export is a row marked `failed` with a reason the
    page can show, not an error that undoes the answer it belongs to.
    """
    if not exports:
        return
    cap = get_settings().AI_EXPORT_MAX_ROWS
    formats = {e.format for e in exports}

    calls = sources(message.queries)
    if not calls:
        _fail(db, exports, "This answer did not query any data, so there is nothing to export.")
        return

    stamp = datetime.now(timezone.utc)
    folder = export_dir() / f"{stamp:%Y}" / f"{stamp:%m}"
    folder.mkdir(parents=True, exist_ok=True)
    base = f"{message.conversation_id[:8]}-{message.id}-{uuid.uuid4().hex[:8]}"
    label = _slug(question)
    parts = {fmt: folder / f".{base}.{fmt}.part" for fmt in formats}

    try:
        problems: list[str] = []
        written: dict[str, tuple[int, bool]] = {}
        for call in reversed(calls):
            arguments, _ = full_arguments(call, question)
            try:
                with EXPORTERS[call["tool"]](arguments, cap) as data:
                    written = _write(data, parts)
                break
            except ExportUnavailable as exc:
                problems.append(f"{call['tool']}: {exc}")
                logger.warning(f"AI export {message.id}: {call['tool']} could not be re-run: {exc}")

        if not written:
            _fail(db, exports, "The data could not be exported. " + "; ".join(problems))
            return

        for export in exports:
            rows, incomplete = written[export.format]
            final = folder / f"{base}.{export.format}"
            os.replace(parts[export.format], final)
            _ready(export, final, f"{label}-{stamp:%Y-%m-%d}.{export.format}", rows, 1, incomplete)
        db.commit()
        logger.info(
            f"AI export {message.id}: "
            + ", ".join(f"{e.format}={e.status} rows={e.row_count}" for e in exports)
        )
    except Exception as exc:  # noqa: BLE001 — an export must never take the answer down
        logger.exception(f"AI export {message.id} failed")
        db.rollback()
        _fail(db, exports, f"The file could not be generated: {type(exc).__name__}.")
    finally:
        for part in parts.values():
            part.unlink(missing_ok=True)


def _ready(export: MessageExport, path: Path, file_name: str, rows: int, sheets: int, truncated: bool) -> None:
    export.status = EXPORT_READY
    export.file_path = path.relative_to(export_dir()).as_posix()
    export.file_name = file_name
    export.row_count = rows
    export.sheet_count = sheets
    export.size_bytes = path.stat().st_size
    export.truncated = truncated
    export.error = None


def _fail(db: Session, exports: list[MessageExport], reason: str) -> None:
    try:
        for export in exports:
            export.status = EXPORT_FAILED
            export.error = reason
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("Could not record the export failure")
