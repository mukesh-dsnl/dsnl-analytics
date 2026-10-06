"""
/csv and /excel: the full data behind an answer, as a downloadable file.

The model only ever reads a capped slice of a result (AI_MAX_ROWS_TO_MODEL),
and the chat shows less still. The file is for the rest of it: after the answer
is saved, every data tool call the model made successfully is run again
without that cap (up to AI_EXPORT_MAX_ROWS) and streamed straight to disk. The
rows never pass through the model, so the file is exact and costs no tokens.

What goes in each format:

  Excel   an "About" sheet (the question, when, and what each sheet holds),
          then one sheet per data query — header row bold and frozen, numbers
          as numbers, identifiers (phones, CRNs, account ids) as text so Excel
          neither drops leading zeros nor shows them as 9.84E+11.
  CSV     one table can only hold one result, so it is the answer's *last*
          successful data query — the one the answer is built on.

Both formats are written in a single pass over the queries, so asking for
/csv /excel together runs each query once. Files are written under a temporary
name and renamed into place when complete, so a crash leaves no half file a
download could serve.
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

from app.ai.tools import ad_hoc_sql, metrics, structured
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


class _Workbook:
    """A streaming (write-only) workbook: rows go to disk as they arrive."""

    def __init__(self) -> None:
        from openpyxl import Workbook

        self.book = Workbook(write_only=True)
        self.about = self.book.create_sheet("About")
        self.used_titles = {"about"}
        self.rows_written = 0
        self.sheets = 0

    def _header_cells(self, sheet, names: list[str]):
        from openpyxl.cell import WriteOnlyCell
        from openpyxl.styles import Alignment, Font, PatternFill

        cells = []
        for name in names:
            cell = WriteOnlyCell(sheet, value=name)
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="1F4E79")
            cell.alignment = Alignment(vertical="center")
            cells.append(cell)
        return cells

    def write_source(
        self, title: str, data: ExportData, sample: list[tuple], batches: Iterator[list[tuple]]
    ) -> tuple[int, bool]:
        """One query's rows as a sheet. Returns (rows written, hit a cap).

        `sample` is the first batch, for sizing columns; `batches` is every
        batch including that one.
        """
        from openpyxl.utils import get_column_letter

        sheet = self.book.create_sheet(_sheet_title(title, self.used_titles))
        self.sheets += 1
        names = [header(c) for c in data.columns]
        as_text = [_is_id(c) for c in data.columns]

        # Widths from the header and the first batch — a write-only sheet has
        # to be told before its first row, and the first batch is a fair sample.
        for index, name in enumerate(names):
            lengths = [len(str(row[index])) for row in sample[:500] if row[index] is not None]
            width = min(max([len(name), *lengths]) + 2, 60)
            sheet.column_dimensions[get_column_letter(index + 1)].width = width
        sheet.freeze_panes = "A2"
        sheet.append(self._header_cells(sheet, names))

        written = 0
        capped = False
        for batch in batches:
            for row in batch:
                if written >= EXCEL_MAX_ROWS:
                    capped = True
                    break
                sheet.append([_excel_value(v, t) for v, t in zip(row, as_text)])
                written += 1
            if capped:
                break
        self.rows_written += written
        return written, capped or written >= data.cap

    def write_about(self, lines: list[tuple[str, Any]]) -> None:
        from openpyxl.cell import WriteOnlyCell
        from openpyxl.styles import Font

        self.about.column_dimensions["A"].width = 22
        self.about.column_dimensions["B"].width = 110
        for label, value in lines:
            cell = WriteOnlyCell(self.about, value=label)
            cell.font = Font(bold=True)
            self.about.append([cell, value])

    def save(self, path: Path) -> None:
        self.book.save(path)


def _chain(first: list[tuple], rest: Iterator[list[tuple]]) -> Iterator[list[tuple]]:
    if first:
        yield first
    yield from rest


def _write_csv(path: Path, data: ExportData, first: list[tuple], rest: Iterator[list[tuple]]) -> int:
    written = 0
    # utf-8-sig: the byte-order mark is what makes Excel open UTF-8 correctly.
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow([header(c) for c in data.columns])
        for batch in _chain(first, rest):
            writer.writerows([_csv_value(v) for v in row] for row in batch)
            written += len(batch)
    return written


def build(db: Session, message: Message, exports: list[MessageExport], question: str) -> None:
    """Produce every pending file for one answer, then record the outcome.

    Never raises: a failed export is a row marked `failed` with a reason the
    page can show, not an error that undoes the answer it belongs to.
    """
    if not exports:
        return
    settings = get_settings()
    cap = settings.AI_EXPORT_MAX_ROWS
    want_csv = any(e.format == "csv" for e in exports)
    want_xlsx = any(e.format == "xlsx" for e in exports)

    calls = sources(message.queries)
    if not calls:
        _fail(db, exports, "This answer did not query any data, so there is nothing to export.")
        return

    stamp = datetime.now(timezone.utc)
    folder = export_dir() / f"{stamp:%Y}" / f"{stamp:%m}"
    folder.mkdir(parents=True, exist_ok=True)
    token = uuid.uuid4().hex[:8]
    base = f"{message.conversation_id[:8]}-{message.id}-{token}"
    label = _slug(question)

    workbook = _Workbook() if want_xlsx else None
    csv_tmp: Path | None = None
    csv_rows = 0
    csv_truncated = False
    about: list[tuple[str, Any]] = []
    problems: list[str] = []
    any_truncated = False

    try:
        for index, call in enumerate(calls, start=1):
            exporter = EXPORTERS[call["tool"]]
            try:
                with exporter(dict(call.get("input") or {}), cap) as data:
                    batches = iter(data.batches)
                    first = next(batches, [])
                    this_csv = folder / f".{base}-{index}.csv.part" if want_csv else None

                    if workbook is not None and this_csv is not None:
                        # One query, two writers: tee each batch to both.
                        rows_seen = [0]

                        def tee(source=batches, out=this_csv) -> Iterator[list[tuple]]:
                            with out.open("w", encoding="utf-8-sig", newline="") as handle:
                                writer = csv.writer(handle)
                                writer.writerow([header(c) for c in data.columns])
                                for chunk in _chain(first, source):
                                    writer.writerows([_csv_value(v) for v in row] for row in chunk)
                                    rows_seen[0] += len(chunk)
                                    yield chunk

                        written, capped = workbook.write_source(
                            f"{index}. {call['tool']}", data, first, tee()
                        )
                        file_rows = rows_seen[0]
                    elif workbook is not None:
                        written, capped = workbook.write_source(
                            f"{index}. {call['tool']}", data, first, _chain(first, batches)
                        )
                        file_rows = written
                    else:
                        file_rows = _write_csv(this_csv, data, first, batches)
                        written, capped = file_rows, file_rows >= data.cap

                    if this_csv is not None:
                        # The CSV is the last query that exported cleanly.
                        if csv_tmp is not None:
                            csv_tmp.unlink(missing_ok=True)
                        csv_tmp, csv_rows, csv_truncated = this_csv, file_rows, file_rows >= data.cap

                    any_truncated |= capped
                    about.append((f"Sheet {index}", data.description))
                    about.append(("", f"{written:,} rows" + (" — reached the export limit; the data may be incomplete" if capped else "")))
                    for note in data.notes:
                        about.append(("", note))
            except ExportUnavailable as exc:
                problems.append(f"Query {index} ({call['tool']}) could not be exported: {exc}")
                logger.warning(f"AI export {message.id}: query {index} skipped: {exc}")

        if (workbook is None or workbook.sheets == 0) and csv_tmp is None:
            _fail(db, exports, "; ".join(problems) or "No query could be exported.")
            return

        for export in exports:
            if export.format == "xlsx" and workbook is not None and workbook.sheets:
                lines = [
                    ("Question", question),
                    ("Generated", f"{stamp:%Y-%m-%d %H:%M} UTC"),
                    ("Rows", f"{workbook.rows_written:,} across {workbook.sheets} sheet(s)"),
                    ("", ""),
                    *about,
                    *([("", ""), ("Skipped", "")] + [("", p) for p in problems] if problems else []),
                ]
                workbook.write_about(lines)
                final = folder / f"{base}.xlsx"
                part = folder / f".{base}.xlsx.part"
                workbook.save(part)
                os.replace(part, final)
                _ready(export, final, f"{label}-{stamp:%Y-%m-%d}.xlsx", workbook.rows_written, workbook.sheets, any_truncated)
            elif export.format == "csv" and csv_tmp is not None:
                final = folder / f"{base}.csv"
                os.replace(csv_tmp, final)
                csv_tmp = None
                _ready(export, final, f"{label}-{stamp:%Y-%m-%d}.csv", csv_rows, 1, csv_truncated)
            else:
                export.status = EXPORT_FAILED
                export.error = "; ".join(problems) or "No query could be exported."
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
        for leftover in folder.glob(f".{base}*.part"):
            leftover.unlink(missing_ok=True)


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
