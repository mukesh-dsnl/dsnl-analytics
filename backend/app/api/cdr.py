"""
CDR analytics API — queries the daily parquet exports where they sit.

There is no upload. Two directories of daily files (CDR_LAKE_PATH /
CODR_LAKE_PATH) are the source of truth, and the date range in the request
decides which of them are opened.

    GET  /api/cdr/status                     what the lake holds, and the default day

    POST /api/cdr/query/dashboard            every panel, in one pass  ← the dashboard
    POST /api/cdr/query/records              raw rows, paginated
    POST /api/cdr/query/by-date              daily breakdown
    POST /api/cdr/query/by-account           per-account, per-service breakdown

Single-panel endpoints, one chart each:

    POST /api/cdr/query/summary              totals for the range
    POST /api/cdr/query/call-direction       dial in vs dial out
    POST /api/cdr/query/connection-status    connected vs not
    POST /api/cdr/query/peak-ports           peak concurrent ports per bucket
    POST /api/cdr/query/service-provider     records per provider code
    POST /api/cdr/query/reblast              reblasts by attempt stage
    POST /api/cdr/query/dtmf                 conferees who entered digits
    POST /api/cdr/query/disconnect-reason    disconnect causes
    POST /api/cdr/query/location             calls by bridge server location

Every query endpoint takes the same filter body (app/schemas/cdr.py::CdrFilter),
in which `date_from` and `date_to` are required. The single-panel routes each
cost their own read of the range, so a client wanting several should ask
/dashboard for all of them at once. Routes delegate to app/cdr/service.py (R19);
no SQL is written here.
"""

import logging

from fastapi import APIRouter, HTTPException

from app.cdr import service
from app.schemas.cdr import (
    CallCubeResponse,
    CdrDashboardResponse,
    CdrFilter,
    CdrLakeStatus,
    CdrQueryResponse,
    CdrRecordsRequest,
    CdrRecordsResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter()


def _not_ready(exc: service.DatasetNotReady) -> HTTPException:
    """409 rather than 404: the lake exists, it just can't answer this range."""
    return HTTPException(status_code=409, detail=str(exc))


@router.get("/cdr/status", response_model=CdrLakeStatus)
def get_cdr_status() -> CdrLakeStatus:
    """
    What the configured directories currently hold.

    Also carries `default_date` — the day the dashboard opens on — so the
    client doesn't have to guess which days exist.
    """
    return CdrLakeStatus(**service.lake_status())


@router.post("/cdr/query/dashboard", response_model=CdrDashboardResponse)
def query_dashboard(body: CdrFilter) -> CdrDashboardResponse:
    """
    Every dashboard panel, computed from a single pass over the range.

    This exists so that opening the dashboard reads each daily file once
    instead of once per panel — on a network share that is the difference
    between seconds and a minute.
    """
    try:
        return CdrDashboardResponse(**service.query_dashboard(body))
    except service.DatasetNotReady as exc:
        raise _not_ready(exc)


@router.post("/cdr/query/records", response_model=CdrRecordsResponse)
def query_records(body: CdrRecordsRequest) -> CdrRecordsResponse:
    """Raw CDR rows for the filtered range, newest first."""
    try:
        return CdrRecordsResponse(**service.query_records(body))
    except service.DatasetNotReady as exc:
        raise _not_ready(exc)


@router.post("/cdr/query/by-date", response_model=CdrQueryResponse)
def query_by_date(body: CdrFilter) -> CdrQueryResponse:
    """Daily breakdown of the filtered range."""
    try:
        return CdrQueryResponse(**service.query_by_date(body))
    except service.DatasetNotReady as exc:
        raise _not_ready(exc)


@router.post("/cdr/query/by-account", response_model=CdrQueryResponse)
def query_by_account(body: CdrFilter) -> CdrQueryResponse:
    """Per-account, per-service breakdown. Always joins CODR — see the service."""
    try:
        return CdrQueryResponse(**service.query_by_account(body))
    except service.DatasetNotReady as exc:
        raise _not_ready(exc)


@router.post("/cdr/query/call-cube", response_model=CallCubeResponse)
def query_call_cube(body: CdrFilter) -> CallCubeResponse:
    """
    One row per (location, connected, direction, provider) combination — what
    the Blast Details bar charts cross-reference for their hover breakdowns.
    """
    try:
        return CallCubeResponse(**service.query_call_cube(body))
    except service.DatasetNotReady as exc:
        raise _not_ready(exc)


# ── Single-panel endpoints ─────────────────────────────────────────────────
# One route per chart, all the same shape: they name a panel and hand back the
# shared {rows, row_count, filters_applied} envelope. Declared from a table
# rather than as twelve near-identical function bodies.

_PANEL_ROUTES: list[tuple[str, str, str]] = [
    # (url path, panel name, summary line)
    ("summary", "summary", "Total calls, participants and minutes for the range."),
    ("call-direction", "call_direction", "Dial In vs Dial Out."),
    ("connection-status", "connection_status", "Connected vs Not Connected."),
    ("peak-ports", "peak_ports", "Peak concurrent ports per bucket."),
    ("service-provider", "service_provider", "Record count per service provider code."),
    ("reblast", "reblast", "Reblasted conferees by attempt stage."),
    ("dtmf", "dtmf", "Count of conferees who entered DTMF digits."),
    ("disconnect-reason", "disconnect_reason", "Disconnect causes for the range."),
    ("location", "location", "Record count per bridge server location (L1, L2, ...)."),
    ("call-funnel", "call_funnel", "Call lifecycle: initiated, ringed, connected, ended."),
    ("call-funnel-direction", "call_funnel_direction", "Call lifecycle stages, split by dial direction."),
    ("call-duration", "call_duration", "Connected-call duration, bucketed in minutes."),
    ("call-duration-direction", "call_duration_direction", "Call duration buckets, split by dial direction."),
]


def _make_panel_route(panel: str):
    def handler(body: CdrFilter) -> CdrQueryResponse:
        try:
            return CdrQueryResponse(**service.query_panel(body, panel))
        except service.DatasetNotReady as exc:
            raise _not_ready(exc)

    return handler


for _path, _panel, _summary in _PANEL_ROUTES:
    router.add_api_route(
        f"/cdr/query/{_path}",
        _make_panel_route(_panel),
        methods=["POST"],
        response_model=CdrQueryResponse,
        name=f"query_{_panel}",
        summary=_summary,
    )
