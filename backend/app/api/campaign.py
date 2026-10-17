"""
Campaign Metrics API — account / service-provider / location breakdowns for a
single day, for the Voicedrop, Conference and Multicall services.

New, and deliberately separate from app/api/cdr.py: this module and
app/cdr/campaign_service.py exist so the feature could be added without
touching any existing CDR analytics route.

    POST /api/campaign/account-wise            per-account breakdown
    POST /api/campaign/account-wise/crn         CRN breakdown within one account
    POST /api/campaign/service-provider-wise    per-service-provider breakdown
    POST /api/campaign/location-wise            per-location breakdown
    POST /api/campaign/campaigns                Voicedrop campaigns, from voicedrop_summary
    POST /api/campaign/campaigns/records        one campaign's call records, from the lake

All take app/schemas/campaign.py::CampaignFilter (a single `date` + `service`);
the CRN drill-down additionally takes the `account_id` to break down.
"""

import logging

from fastapi import APIRouter, HTTPException

from app.cdr import campaign_service as service
from app.ai.tools import voicedrop_report
from app.cdr import voicedrop_summary
from app.schemas.campaign import (
    AccountCrnRequest,
    AccountInsightRequest,
    AccountInsightResponse,
    AccountWiseRequest,
    CampaignAccountCrnResponse,
    CampaignAccountResponse,
    CampaignFilter,
    CampaignLocationResponse,
    CampaignRecordsRequest,
    CampaignServiceProviderResponse,
    VoicedropCampaignsResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter()


def _not_ready(exc: service.DatasetNotReady) -> HTTPException:
    """409 rather than 404: the lake exists, it just can't answer this day."""
    return HTTPException(status_code=409, detail=str(exc))


@router.post("/campaign/account-wise", response_model=CampaignAccountResponse)
def account_wise(body: AccountWiseRequest) -> CampaignAccountResponse:
    """
    Per-account breakdown for the day.

    `search` narrows to accounts matching on account id, CRN, or (Conference
    and Multicall) chairperson PIN — see the service for why that is matched
    here rather than in the client.
    """
    try:
        rows = service.query_account_wise(body, body.search)
    except service.DatasetNotReady as exc:
        raise _not_ready(exc)
    return CampaignAccountResponse(rows=rows)


@router.post("/campaign/account-wise/crn", response_model=CampaignAccountCrnResponse)
def account_crn(body: AccountCrnRequest) -> CampaignAccountCrnResponse:
    try:
        rows = service.query_account_crn(body, body.account_id)
    except service.DatasetNotReady as exc:
        raise _not_ready(exc)
    return CampaignAccountCrnResponse(account=body.account_id, rows=rows)


@router.post("/campaign/account-insight", response_model=AccountInsightResponse)
def account_insight(body: AccountInsightRequest) -> AccountInsightResponse:
    """
    Everything the per-row chart popup draws, for one account (optionally one
    CRN within it).

    Its own endpoint, and requested only when a row's chart icon is actually
    clicked — the table never pays for these aggregates.
    """
    try:
        return AccountInsightResponse(
            **service.query_account_insight(body, body.account_id, body.crn)
        )
    except service.DatasetNotReady as exc:
        raise _not_ready(exc)


@router.post("/campaign/service-provider-wise", response_model=CampaignServiceProviderResponse)
def service_provider_wise(body: CampaignFilter) -> CampaignServiceProviderResponse:
    try:
        rows = service.query_service_provider_wise(body)
    except service.DatasetNotReady as exc:
        raise _not_ready(exc)
    return CampaignServiceProviderResponse(rows=rows)


@router.post("/campaign/location-wise", response_model=CampaignLocationResponse)
def location_wise(body: CampaignFilter) -> CampaignLocationResponse:
    try:
        rows = service.query_location_wise(body)
    except service.DatasetNotReady as exc:
        raise _not_ready(exc)
    return CampaignLocationResponse(rows=rows)


@router.post("/campaign/campaigns", response_model=VoicedropCampaignsResponse)
def voicedrop_campaigns(body: CampaignFilter) -> VoicedropCampaignsResponse:
    """
    The day's Voicedrop campaigns, one row per CRN, from the summary table on
    192.168.0.117 (q100_dump.voicedrop_summary). Voicedrop only. Read-only.
    """
    if body.service != "voicedrop":
        raise HTTPException(status_code=400, detail="Campaigns are available for Voicedrop only.")
    try:
        rows = voicedrop_summary.campaigns_for(body.date)
    except voicedrop_summary.SourceNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:  # noqa: BLE001 — a source outage is reported, not raised
        logger.error(f"Voicedrop campaigns failed for {body.date}: {exc}")
        raise HTTPException(status_code=502, detail="The campaign summary database could not be read.")
    return VoicedropCampaignsResponse(rows=rows)


@router.post("/campaign/campaigns/records")
def voicedrop_campaign_records(body: CampaignRecordsRequest) -> dict:
    """
    One campaign's call records — one row per number dialled, every row — by
    the reporting team's query (CALL_DATE, CRN, PHONE_NUMBER, STATUS, CALL_TYPE,
    START_TIME, DURATION_SECS, ATTEMPTS, ordered by STATUS), read from the CDR
    lake for that day, account and CRN.
    """
    try:
        return voicedrop_report.call_records(body.date, body.account_id, body.crn)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Campaign records failed for {body}: {exc}")
        raise HTTPException(status_code=502, detail="The call records could not be read from the CDR lake.")
