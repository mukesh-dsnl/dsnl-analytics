"""Pydantic schemas for the CDR analytics query endpoints."""

from datetime import date, time
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, ValidationInfo, field_validator, model_validator

from app.core.config import get_settings

ServiceFilter = Literal["all", "voicedrop", "conference", "multicall"]


class CdrFilter(BaseModel):
    """
    The one filter body shared by every query endpoint.

    `date_from` and `date_to` are required and inclusive. They are not just a
    filter: they decide which daily files are opened at all, and the lake holds
    close to a year of them on a network share. There is no sensible "whole
    lake" default, so the caller always names a range.

    Everything else is optional. `service` only narrows for the three concrete
    services — "all" and null are both "no restriction".
    """

    date_from: date
    date_to: date
    service: Optional[ServiceFilter] = None
    account_id: Optional[str] = None
    crn: Optional[str] = None
    conf_num: Optional[str] = None
    # Chairperson PIN — CODR.CHAIR_PIN. Only meaningful for Conference and
    # Multicall, but setting it forces the CODR join regardless of service
    # (see filters.needs_codr) so it works from any tab.
    cpin: Optional[str] = None
    time_from: Optional[time] = None
    time_to: Optional[time] = None

    @field_validator("account_id", "crn", "conf_num", "cpin")
    @classmethod
    def _blank_to_none(cls, v: Optional[str]) -> Optional[str]:
        """Treat "" from a cleared UI field as "not filtering"."""
        if v is None:
            return None
        v = v.strip()
        return v or None

    @model_validator(mode="after")
    def _check_range(self, info: ValidationInfo) -> "CdrFilter":
        if self.date_to < self.date_from:
            raise ValueError("date_to must not be earlier than date_from.")

        # CDR_MAX_RANGE_DAYS is the dashboard's ceiling, chosen for what a
        # person is willing to wait for on a network share. A caller with a
        # different budget can name its own via validation context:
        #
        #     CdrFilter.model_validate(data, context={"max_range_days": 31})
        #
        # The AI tools do exactly that — their questions ("day by day across a
        # fortnight") are legitimately wider than a dashboard panel, and
        # inheriting the dashboard's limit made whole classes of question
        # unanswerable rather than merely slow. Absent a context this is
        # unchanged, so every existing endpoint keeps the same ceiling.
        context = info.context or {}
        max_days = context.get("max_range_days") or get_settings().CDR_MAX_RANGE_DAYS
        limit_name = "max_range_days" if context.get("max_range_days") else "CDR_MAX_RANGE_DAYS"

        span = (self.date_to - self.date_from).days + 1
        if span > max_days:
            raise ValueError(
                f"Date range spans {span} days; the limit is {max_days} "
                f"({limit_name}). Narrow the range or raise the limit."
            )
        return self

    @property
    def span_days(self) -> int:
        return (self.date_to - self.date_from).days + 1


class CdrRecordsRequest(CdrFilter):
    """Filter body plus paging, for the raw-rows endpoint."""

    page: int = Field(1, ge=1)
    page_size: int = Field(100, ge=1, le=1000)


class CdrLakeSide(BaseModel):
    """What one side of the lake (CDR or CODR) currently holds."""

    available: bool
    day_count: int = 0
    date_min: Optional[str] = None
    date_max: Optional[str] = None
    missing_days: Optional[int] = None
    error: Optional[str] = None


class CdrLakeStatus(BaseModel):
    """
    GET /api/cdr/status — what the configured directories hold right now.

    There is no ingest and so no ingest state: the lake is either readable or
    it isn't. `default_date` is the day the dashboard should open on.
    """

    available: bool
    cdr: CdrLakeSide
    codr: CdrLakeSide
    max_range_days: int
    default_date: Optional[str] = None


class CdrQueryResponse(BaseModel):
    """Shared response envelope for the single-panel query endpoints."""

    rows: list[dict[str, Any]]
    row_count: int
    # Echoed back so a caller can confirm what the server actually applied.
    filters_applied: dict[str, Any]
    truncated: bool = False
    # Which days the answer was built from. Absent on the breakdowns that
    # don't report it.
    coverage: Optional["CdrCoverage"] = None


class CdrRecordsResponse(CdrQueryResponse):
    page: int
    page_size: int
    total: int
    total_pages: int


class CdrSummary(BaseModel):
    total_calls: int = 0
    # Distinct trailing-10-digit phone numbers in the slice — TEL_DIGIT on
    # dial-out legs, CLI on dial-in ones. Counts subscribers reached, where
    # total_calls counts the attempts made at them.
    total_phone_numbers: int = 0
    minutes_usage: int = 0
    # Distinct CRN + CONF_NUM pairs — one conference/multicall room, however
    # many call legs it generated. Meaningful once the service is scoped to
    # Conference or Multicall; the frontend leaves it off the All/Voicedrop
    # KPI rows.
    total_conferences: int = 0


class CategoryDatum(BaseModel):
    """One row of a categorical breakdown."""

    label: str
    value: float


class PeakPortDatum(BaseModel):
    bucket: str
    peak: float


class CdrReblast(BaseModel):
    total: float = 0
    stages: list[CategoryDatum] = Field(default_factory=list)


class ReblastAidConnectionDatum(BaseModel):
    """One AID_COUNT value within a blast, split Connected / Not Connected."""

    label: str
    connected: int = 0
    not_connected: int = 0


class ReblastAidDatum(BaseModel):
    """One blast, and how its calls split across AID_COUNT — the Reblast chart's hover."""

    label: str
    aid: list[ReblastAidConnectionDatum] = Field(default_factory=list)


class DirectionSplitDatum(BaseModel):
    """One category's count, split by dial direction — the hover breakdown for Call Ratio and Call Duration."""

    label: str
    dial_in: int = 0
    dial_out: int = 0


class LocationMinutesDatum(BaseModel):
    """One location's connected-call minutes, split by dial direction — the Minutes Usage KPI's hover."""

    label: str
    minutes: int = 0
    dial_in: int = 0
    dial_out: int = 0


class CdrCoverage(BaseModel):
    """Which days the answer was actually built from."""

    days_requested: int
    days_matched: int
    first_day: Optional[str] = None
    last_day: Optional[str] = None
    # Width of one peak-ports bucket, chosen from the range — see service.py.
    # Absent for answers that have no time series.
    bucket: Optional[str] = None


CdrQueryResponse.model_rebuild()


class CdrDashboardResponse(BaseModel):
    """
    Every panel from one pass over the range.

    The dashboard asks for all of these at once precisely so the daily files
    are read once rather than once per panel.
    """

    summary: CdrSummary
    dtmf: int
    call_direction: list[CategoryDatum]
    connection_status: list[CategoryDatum]
    peak_ports: list[PeakPortDatum]
    service_provider: list[CategoryDatum]
    reblast: CdrReblast
    reblast_aid: list[ReblastAidDatum]
    disconnect_reason: list[CategoryDatum]
    location: list[CategoryDatum]
    minutes_by_location: list[LocationMinutesDatum]
    call_funnel: list[CategoryDatum]
    # Same four stages as call_funnel, each split by dial direction — the
    # Call Ratio chart's hover reads from this instead of re-deriving it.
    call_funnel_direction: list[DirectionSplitDatum]
    # Connected-call duration, bucketed in minutes — Voicedrop only, like
    # call_funnel, since that's the page this was built for.
    call_duration: list[CategoryDatum]
    call_duration_direction: list[DirectionSplitDatum]
    filters_applied: dict[str, Any]
    coverage: CdrCoverage


class CallCubeRow(BaseModel):
    """
    One combination of location, connection status, call direction and
    service provider, and how many calls fall in it.

    The joint distribution — not four independent breakdowns — is what lets
    the Blast Details charts answer "of the calls in this bar, how many were
    dial-in vs dial-out" on hover, rather than only "how many calls total".
    """

    location: str
    is_connected: bool
    call_direction: str
    service_provider: str
    count: int


class CallCubeResponse(BaseModel):
    """The whole cube in one payload — small by construction, a few dozen rows for typical ranges."""

    rows: list[CallCubeRow]
    total_calls: int
    coverage: CdrCoverage
