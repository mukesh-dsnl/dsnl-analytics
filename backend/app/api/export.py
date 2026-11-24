"""
Report export: a page's figures as a file.

    POST /api/export/report?format=xlsx|html

The page sends what it is already showing — a title, its filters, the headline
figures and the tables behind its charts — and gets the same report back as an
Excel workbook or a self-contained HTML page (which the browser can also print
to PDF). Nothing is re-read from the lake: the figures are exactly what the
page shows, and the export is instant.
"""

from typing import Literal, Optional, Union

from fastapi import APIRouter, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.reports import render

router = APIRouter()

Cell = Union[str, int, float, None]


class ReportColumn(BaseModel):
    label: str
    # id: an identifier written as text (CRN, phone, DID), so Excel neither
    # drops leading zeros nor shows 9.84E+11. percent: 0-100.
    kind: Literal["text", "id", "number", "percent"] = "text"


class ReportSection(BaseModel):
    title: str
    note: Optional[str] = None
    columns: list[ReportColumn]
    rows: list[list[Cell]] = Field(default_factory=list)
    total: Optional[list[Cell]] = None
    # Which column draws a bar in the HTML report (its share of that column's max).
    bar: Optional[int] = None
    # Only in these formats — e.g. a per-minute table that belongs in Excel only.
    formats: Optional[list[Literal["xlsx", "html"]]] = None
    # The Excel sheet this table goes on. Tables naming the same sheet stack on
    # it, top to bottom; "Summary" adds the table under the headline figures.
    # Defaults to a sheet of its own, named after the title.
    sheet: Optional[str] = None


class ReportKpi(BaseModel):
    label: str
    value: Union[int, float]
    note: Optional[str] = None


class Report(BaseModel):
    title: str
    subtitle: Optional[str] = None
    filename: str = Field(min_length=1, max_length=120)
    meta: list[tuple[str, str]] = Field(default_factory=list)
    kpis: list[ReportKpi] = Field(default_factory=list)
    sections: list[ReportSection] = Field(default_factory=list)
    # The printed (PDF) page: landscape for wide tables.
    orientation: Literal["portrait", "landscape"] = "portrait"


@router.post("/export/report")
def export_report(body: Report, format: Literal["xlsx", "html"] = Query()) -> Response:
    if format == "xlsx":
        content = render.xlsx(body)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        content = render.html(body).encode("utf-8")
        media = "text/html; charset=utf-8"
    name = f"{render.safe_name(body.filename)}.{format}"
    return Response(content, media_type=media, headers={"Content-Disposition": f'attachment; filename="{name}"'})
