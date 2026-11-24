"""
Renders a report (app/api/export.py::Report) as an Excel workbook or an HTML page.

Excel: a Summary sheet (title, filters, headline figures, and any table sent
to it), then the other tables, each drawn as a grid — several tables can share
a sheet, stacked top to bottom.

HTML: one self-contained page (no scripts, no external files) laid out like
the app — headline tiles, then each table as a card with a bar beside the
figure it charts. Its print styles make "Save as PDF" from the browser give a
clean A4 report, portrait or landscape.
"""

import html as _html
import io
import re
from datetime import datetime
from typing import Any

# A sheet name is at most 31 characters, without : \ / ? * [ ].
_SHEET_BAD = re.compile(r"[:\\/?*\[\]]")


def safe_name(name: str) -> str:
    """A filename without path or shell-unfriendly characters."""
    return re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-.") or "report"


def _wanted(section: Any, fmt: str) -> bool:
    return not section.formats or fmt in section.formats


def _number(value: Any) -> str:
    if value is None or value == "":
        return "—"
    if isinstance(value, float) and not value.is_integer():
        return f"{value:,.1f}"
    try:
        return f"{int(value):,}"
    except (TypeError, ValueError):
        return str(value)


def _cell_text(value: Any, kind: str) -> str:
    if value is None or value == "":
        return "—"
    if kind == "percent":
        try:
            return f"{float(value):.1f}%"
        except (TypeError, ValueError):
            return str(value)
    if kind == "number":
        return _number(value)
    return str(value)


# ── Excel ────────────────────────────────────────────────────────────────
#
# Every table is drawn as a grid: a title line, a blue header row, thin borders
# round every cell, light banding on alternate rows, numbers right-aligned in
# their formats, and a bold Total row. Tables naming the same sheet stack on it
# with a gap between them.

_BLUE = "2563EB"
_GRID = "D5DFEC"
_BAND = "F6F9FD"
_TOTAL = "E8F0FB"


def _styles() -> dict[str, Any]:
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    side = Side(style="thin", color=_GRID)
    return {
        "border": Border(left=side, right=side, top=side, bottom=side),
        "head_font": Font(bold=True, color="FFFFFF"),
        "head_fill": PatternFill("solid", fgColor=_BLUE),
        "band": PatternFill("solid", fgColor=_BAND),
        "total_fill": PatternFill("solid", fgColor=_TOTAL),
        "bold": Font(bold=True),
        "title": Font(bold=True, size=13, color="16213A"),
        "big": Font(bold=True, size=15, color="16213A"),
        "muted": Font(italic=True, color="6A7D96"),
        "right": Alignment(horizontal="right", vertical="center"),
        "left": Alignment(horizontal="left", vertical="center"),
    }


def _write_table(sheet: Any, start: int, section: Any, s: dict[str, Any], widths: dict[int, int]) -> int:
    """Writes one table from row `start`; returns the next free row."""
    r = start
    sheet.cell(r, 1, section.title).font = s["title"]
    r += 1
    if section.note:
        sheet.cell(r, 1, section.note).font = s["muted"]
        r += 1

    for index, column in enumerate(section.columns, start=1):
        cell = sheet.cell(r, index, column.label)
        cell.font, cell.fill, cell.border = s["head_font"], s["head_fill"], s["border"]
        cell.alignment = s["right"] if column.kind in ("number", "percent") else s["left"]
        widths[index] = max(widths.get(index, 0), len(column.label) + 3)
    r += 1

    def put(row: list[Any], kind: str) -> None:
        nonlocal r
        for index, column in enumerate(section.columns, start=1):
            value = row[index - 1] if index - 1 < len(row) else None
            if column.kind == "id" and value is not None:
                value = str(value)
            cell = sheet.cell(r, index, value)
            cell.border = s["border"]
            if column.kind in ("number", "percent"):
                cell.alignment = s["right"]
                if isinstance(value, (int, float)):
                    if column.kind == "percent":
                        cell.number_format = '0.0"%"'
                    else:
                        cell.number_format = "#,##0" if float(value).is_integer() else "#,##0.0"
            else:
                cell.alignment = s["left"]
            if kind == "total":
                cell.font, cell.fill = s["bold"], s["total_fill"]
            elif kind == "band":
                cell.fill = s["band"]
            widths[index] = max(widths.get(index, 0), min(len(_cell_text(value, column.kind)) + 3, 60))
        r += 1

    for n, row in enumerate(section.rows):
        put(row, "band" if n % 2 else "plain")
    if section.total:
        put(section.total, "total")
    return r


def xlsx(report: Any) -> bytes:
    from openpyxl import Workbook
    from openpyxl.utils import get_column_letter

    s = _styles()
    book = Workbook()
    sheets: dict[str, tuple[Any, list[int], dict[int, int]]] = {}  # name -> (sheet, [next row], widths)

    # Summary: title, filters, then the headline figures as a grid.
    summary = book.active
    summary.title = "Summary"
    summary.cell(1, 1, report.title).font = s["big"]
    r = 2
    if report.subtitle:
        summary.cell(r, 1, report.subtitle).font = s["muted"]
        r += 1
    summary.cell(r, 1, f"Generated {datetime.now():%d %b %Y, %H:%M}").font = s["muted"]
    r += 2
    widths = {1: 24, 2: 22, 3: 46}
    for label, value in report.meta:
        key, val = summary.cell(r, 1, label), summary.cell(r, 2, value)
        key.font, key.fill = s["bold"], s["band"]
        for c in (key, val):
            c.border, c.alignment = s["border"], s["left"]
        r += 1
    if report.kpis:
        r += 1
        for index, label in enumerate(("Figure", "Value", "Note"), start=1):
            c = summary.cell(r, index, label)
            c.font, c.fill, c.border = s["head_font"], s["head_fill"], s["border"]
            c.alignment = s["right"] if index == 2 else s["left"]
        r += 1
        for kpi in report.kpis:
            cells = [summary.cell(r, 1, kpi.label), summary.cell(r, 2, kpi.value), summary.cell(r, 3, kpi.note or "")]
            cells[0].font = s["bold"]
            cells[1].number_format = "#,##0.##"
            cells[1].alignment = s["right"]
            for c in cells:
                c.border = s["border"]
            r += 1
    sheets["Summary"] = (summary, [r + 1], widths)

    for section in report.sections:
        if not _wanted(section, "xlsx"):
            continue
        name = _SHEET_BAD.sub(" ", section.sheet or section.title)[:31].strip() or "Sheet"
        if name not in sheets:
            sheets[name] = (book.create_sheet(name), [1], {})
        sheet, next_row, widths = sheets[name]
        end = _write_table(sheet, next_row[0], section, s, widths)
        next_row[0] = end + 2  # a blank line between stacked tables

    for sheet, _, widths in sheets.values():
        for index, width in widths.items():
            sheet.column_dimensions[get_column_letter(index)].width = max(width, 10)
        sheet.sheet_view.showGridLines = False

    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


# ── HTML ─────────────────────────────────────────────────────────────────

_STYLE = """
  :root { --ink:#16213a; --muted:#6a7d96; --line:#e6ecf4; --blue:#2563eb; --pale:#eef4fb; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f5f8fc; color: var(--ink); font: 13px/1.5 Inter, 'Segoe UI', system-ui, sans-serif; font-variant-numeric: tabular-nums; }
  .page { max-width: 1040px; margin: 0 auto; padding: 32px 28px 48px; }
  .page.landscape { max-width: 1400px; }
  header { background: linear-gradient(135deg, #1d4ed8, #0ea5e9); color: #fff; border-radius: 16px; padding: 22px 26px; }
  header .eyebrow { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; opacity: .85; }
  header h1 { margin: 4px 0 2px; font-size: 24px; letter-spacing: -.01em; }
  header p { margin: 0; opacity: .9; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  .meta span { background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.25); border-radius: 999px; padding: 3px 11px; font-size: 12px; }
  .meta b { font-weight: 600; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin: 18px 0 8px; }
  .kpi { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; }
  .kpi .label { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
  .kpi .value { font-size: 24px; font-weight: 650; letter-spacing: -.02em; margin-top: 4px; }
  .kpi .note { font-size: 12px; color: var(--muted); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }
  .card { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px 10px; break-inside: avoid; }
  .card.wide { grid-column: 1 / -1; }
  .card.long { break-inside: auto; }
  .card h2 { margin: 0; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: #2f5a8c; border-bottom: 1px solid #cfe0f3; padding: 6px 8px 6px 0; }
  td { border-bottom: 1px solid #eef2f7; padding: 6px 8px 6px 0; }
  th.num, td.num { text-align: right; }
  tr.total td { font-weight: 700; background: var(--pale); border-bottom: 0; }
  .bar { position: relative; height: 7px; min-width: 70px; background: #eef2f7; border-radius: 99px; overflow: hidden; }
  .bar i { position: absolute; inset: 0 auto 0 0; background: var(--blue); border-radius: 99px; }
  .note { color: var(--muted); font-size: 11.5px; margin: 6px 0 4px; }
  footer { margin-top: 22px; color: var(--muted); font-size: 11px; text-align: center; }
  @page { size: A4 __ORIENT__; margin: 12mm; }
  @media print {
    body { background: #fff; }
    .page { max-width: none; padding: 0; }
    header, .bar, .bar i, tr.total td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    thead { display: table-header-group; }
  }
  @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
"""


def _esc(value: Any) -> str:
    return _html.escape(str(value), quote=True)


def _table(section: Any) -> str:
    cols = section.columns
    numeric = [c.kind in ("number", "percent") for c in cols]
    bar_max = 0.0
    if section.bar is not None:
        bar_max = max((float(r[section.bar] or 0) for r in section.rows if len(r) > section.bar), default=0.0)

    head = "".join(f'<th class="{"num" if numeric[i] else ""}">{_esc(c.label)}</th>' for i, c in enumerate(cols))
    if section.bar is not None:
        head += "<th></th>"

    def row_html(row: list[Any], css: str = "") -> str:
        cells = "".join(
            f'<td class="{"num" if numeric[i] else ""}">{_esc(_cell_text(row[i] if i < len(row) else None, c.kind))}</td>'
            for i, c in enumerate(cols)
        )
        if section.bar is not None:
            if css:
                cells += "<td></td>"
            else:
                value = float(row[section.bar] or 0) if len(row) > section.bar else 0.0
                width = (value / bar_max * 100) if bar_max else 0
                cells += f'<td style="width:24%"><div class="bar"><i style="width:{width:.1f}%"></i></div></td>'
        return f'<tr class="{css}">{cells}</tr>'

    body = "".join(row_html(r) for r in section.rows)
    if section.total:
        body += row_html(section.total, "total")
    return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"


def html(report: Any) -> str:
    meta = "".join(f"<span>{_esc(label)}: <b>{_esc(value)}</b></span>" for label, value in report.meta)
    kpis = "".join(
        f'<div class="kpi"><div class="label">{_esc(k.label)}</div><div class="value">{_esc(_number(k.value))}</div>'
        f'<div class="note">{_esc(k.note or "")}</div></div>'
        for k in report.kpis
    )
    cards = []
    for section in report.sections:
        if not _wanted(section, "html"):
            continue
        # A table of more than a few columns, or many rows, takes the full width;
        # a long one may break across printed pages.
        wide = report.orientation == "landscape" or len(section.columns) > 3 or len(section.rows) > 12
        long = len(section.rows) > 30
        note = f'<p class="note">{_esc(section.note)}</p>' if section.note else ""
        css = "card" + (" wide" if wide else "") + (" long" if long else "")
        cards.append(f'<section class="{css}"><h2>{_esc(section.title)}</h2>{note}{_table(section)}</section>')
    subtitle = f"<p>{_esc(report.subtitle)}</p>" if report.subtitle else ""
    kpi_block = f'<div class="kpis">{kpis}</div>' if report.kpis else ""
    page_css = "page landscape" if report.orientation == "landscape" else "page"
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{_esc(report.title)}</title><style>{_STYLE.replace("__ORIENT__", report.orientation)}</style></head>
<body><div class="{page_css}">
<header><div class="eyebrow">DSNL Analytics</div><h1>{_esc(report.title)}</h1>{subtitle}<div class="meta">{meta}</div></header>
{kpi_block}
<div class="grid">{''.join(cards)}</div>
<footer>Generated {datetime.now():%d %b %Y, %H:%M}</footer>
</div></body></html>"""
