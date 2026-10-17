"""The Voicedrop Campaigns table: one SELECT per day from voicedrop_summary."""

from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.api import campaign
from app.cdr import voicedrop_summary
from app.schemas.campaign import CampaignFilter


def test_mysql_time_values_read_as_clock_times():
    assert voicedrop_summary._time(timedelta(hours=9, minutes=15, seconds=59)) == "09:15:59"
    assert voicedrop_summary._time(None) is None


def test_the_route_returns_the_days_campaigns(monkeypatch):
    seen = []

    def fake(day):
        seen.append(day)
        return [{"account_id": 1152, "client_id": 7740, "crn": 302669, "connected": 1134, "not_connected": 4271}]

    monkeypatch.setattr(voicedrop_summary, "campaigns_for", fake)
    response = campaign.voicedrop_campaigns(CampaignFilter(date="2026-10-15", service="voicedrop"))
    assert seen == [date(2026, 10, 15)]
    assert response.rows[0].crn == 302669 and response.rows[0].dnd_count == 0


def test_campaigns_are_voicedrop_only_and_report_a_missing_source(monkeypatch):
    with pytest.raises(HTTPException) as exc:
        campaign.voicedrop_campaigns(CampaignFilter(date="2026-10-15", service="conference"))
    assert exc.value.status_code == 400

    def unconfigured(day):
        raise voicedrop_summary.SourceNotConfigured("Set VOICEDROP_SUMMARY_DATABASE_URL")

    monkeypatch.setattr(voicedrop_summary, "campaigns_for", unconfigured)
    with pytest.raises(HTTPException) as exc:
        campaign.voicedrop_campaigns(CampaignFilter(date="2026-10-15", service="voicedrop"))
    assert exc.value.status_code == 503
