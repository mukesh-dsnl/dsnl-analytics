"""
Pydantic schemas for the Campaign Metrics endpoints.

Separate from app/schemas/cdr.py on purpose — Campaign Metrics is a single-day,
three-service (Voicedrop/Conference/Multicall) report, not a date-range query,
so its filter body doesn't fit CdrFilter and isn't meant to.
"""

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

CampaignService = Literal["voicedrop", "conference", "multicall"]


class CampaignFilter(BaseModel):
    """The one filter body every Campaign Metrics endpoint takes: a single day and a service."""

    date: date
    service: CampaignService


class AccountCrnRequest(CampaignFilter):
    """CampaignFilter plus which account's CRNs to break down."""

    account_id: str

    @field_validator("account_id")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("account_id must not be blank.")
        return v


class CampaignMetricsRow(BaseModel):
    """The four figures every breakdown reports, whatever it's grouped by."""

    total_size: int = 0
    connected_size: int = 0
    not_connected_size: int = 0
    connected_percentage: float = 0.0


class AccountMetricsRow(CampaignMetricsRow):
    account: str
    total_minutes: int = 0


class AccountCrnMetricsRow(CampaignMetricsRow):
    crn: str
    total_minutes: int = 0


class ServiceProviderMetricsRow(CampaignMetricsRow):
    service_provider: str


class LocationMetricsRow(CampaignMetricsRow):
    location: str


class CampaignAccountResponse(BaseModel):
    rows: list[AccountMetricsRow]


class CampaignAccountCrnResponse(BaseModel):
    account: str
    rows: list[AccountCrnMetricsRow]


class CampaignServiceProviderResponse(BaseModel):
    rows: list[ServiceProviderMetricsRow]


class CampaignLocationResponse(BaseModel):
    rows: list[LocationMetricsRow]


# ── Account insight (the per-row chart popup) ──────────────────────────────


class AccountInsightRequest(CampaignFilter):
    """CampaignFilter plus the row being charted — an account, optionally one CRN within it."""

    account_id: str
    crn: Optional[str] = None

    @field_validator("account_id")
    @classmethod
    def _account_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("account_id must not be blank.")
        return v

    @field_validator("crn")
    @classmethod
    def _blank_to_none(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        return v.strip() or None


class InsightSummary(BaseModel):
    total_uploaded: int = 0
    dial_attempts: int = 0
    connected_users: int = 0
    connect_percentage: float = 0.0


class InsightFailure(BaseModel):
    """Failed attempts, split by whether the number ever rang (ALERT)."""

    total: int = 0
    never_rang: int = 0
    rang_unanswered: int = 0
    never_rang_percentage: float = 0.0
    rang_unanswered_percentage: float = 0.0


class InsightDisconnectReason(BaseModel):
    reason: str
    count: int = 0
    percentage: float = 0.0


class InsightCarrier(BaseModel):
    carrier: str
    total: int = 0
    connected: int = 0
    connect_percentage: float = 0.0


class InsightAid(BaseModel):
    """One AID group's four bars, plus the dial-out total its dotted line marks."""

    label: str
    proceeded: int = 0
    alert: int = 0
    connected: int = 0
    ended: int = 0
    total_initiated: int = 0


class InsightBlast(BaseModel):
    label: str
    aids: list[InsightAid] = Field(default_factory=list)


class AccountInsightResponse(BaseModel):
    account: str
    crn: Optional[str] = None
    summary: InsightSummary
    failed: InsightFailure
    disconnect_reasons: list[InsightDisconnectReason] = Field(default_factory=list)
    carriers: list[InsightCarrier] = Field(default_factory=list)
    blasts: list[InsightBlast] = Field(default_factory=list)
