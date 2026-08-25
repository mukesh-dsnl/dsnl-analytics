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

All take app/schemas/campaign.py::CampaignFilter (a single `date` + `service`);
the CRN drill-down additionally takes the `account_id` to break down.
"""

import logging

from fastapi import APIRouter, HTTPException

from app.cdr import campaign_service as service
from app.schemas.campaign import (
    AccountCrnRequest,
    AccountInsightRequest,
    AccountInsightResponse,
    CampaignAccountCrnResponse,
    CampaignAccountResponse,
    CampaignFilter,
    CampaignLocationResponse,
    CampaignServiceProviderResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter()


def _not_ready(exc: service.DatasetNotReady) -> HTTPException:
    """409 rather than 404: the lake exists, it just can't answer this day."""
    return HTTPException(status_code=409, detail=str(exc))


@router.post("/campaign/account-wise", response_model=CampaignAccountResponse)
def account_wise(body: CampaignFilter) -> CampaignAccountResponse:
    try:
        rows = service.query_account_wise(body)
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
