"""Conference › Summary: conference_summary rows, and the daily view over both tables."""

from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.api import conference_summary as api
from app.cdr import conference_summary as tables
from app.cdr import voicedrop_summary


def test_dids_drop_the_float_tails_and_blanks():
    assert tables._dids("34168016.0, 34170005.0, , nan, 45366983") == ["34168016", "34170005", "45366983"]
    assert tables._dids(None) == [] and tables._dids("") == []


def test_room_length_wraps_past_midnight():
    assert tables._minutes_between(timedelta(hours=18, minutes=49), timedelta(hours=19, minutes=41)) == 52
    assert tables._minutes_between(timedelta(hours=23, minutes=50), timedelta(minutes=10)) == 20
    assert tables._minutes_between(None, timedelta(hours=1)) is None


def _rollup(day, **overrides):
    row = {"day": day, "conferences": 10, "accounts": 3, "ringed": 100, "connected": 40, "call_minutes": 500,
           "attended_minutes": 300, "peak_port": 90, "party_0": 2, "party_1": 1, "party_2": 4, "party_3": 1,
           "party_above_3": 2}
    row.update(overrides)
    return row


def test_daily_lays_the_daily_table_over_the_rollup(monkeypatch):
    d1, d2, d3 = date(2026, 11, 2), date(2026, 11, 1), date(2026, 10, 31)
    official = {"day": d1, "Total_Count": 12, "ACS_Count": 9, "Proxy_Count": 2, "Multicall_Count": 1,
                "Party_0": 3, "Party_1": 1, "Party_2": 4, "Party_3": 1, "Party_Above_3": 3}
    only_official = {**official, "day": d3}

    def fake_fetch(sql, params=None):
        if "FROM conference_daily_summary" in sql:
            return [official, only_official]
        return [_rollup(d1), _rollup(d2)]

    monkeypatch.setattr(tables, "_fetch", fake_fetch)
    lines = tables.daily(d1, 3)
    assert [line["date"] for line in lines] == ["2026-11-02", "2026-11-01", "2026-10-31"]
    first, second, third = lines
    assert first["source"] == "conference_daily_summary" and first["acs_count"] == 9 and first["party_0"] == 3
    assert first["ringed"] == 100  # detail figures stay
    assert second["source"] == "conference_summary" and second["acs_count"] is None and second["party_0"] == 2
    assert third["source"] == "conference_daily_summary" and third["conferences"] == 0


def test_a_missing_source_is_503(monkeypatch):
    def unconfigured(*_):
        raise voicedrop_summary.SourceNotConfigured("Set VOICEDROP_SUMMARY_DATABASE_URL")

    monkeypatch.setattr(tables, "status", unconfigured)
    with pytest.raises(HTTPException) as exc:
        api.conference_status()
    assert exc.value.status_code == 503


# ── Account and business views (conference_insights) ─────────────────────────

from app.cdr import conference_insights as insights  # noqa: E402


def _day(day, account_id, conferences=2, ringed=100, connected=40, attended=300, peak=50, empty=0):
    return {"day": day, "account_id": account_id, "conferences": conferences, "ringed": ringed, "connected": connected,
            "call_minutes": attended * 2, "attended_minutes": attended, "peak_port": peak, "empty_rooms": empty}


def test_months_take_the_highest_peak_port_and_rate_against_ringed():
    rows = [_day(date(2026, 10, 1), 1, peak=80, empty=1), _day(date(2026, 10, 2), 1, peak=30)]
    [october] = insights.monthly_totals(rows)
    assert october["peak_port"] == 80 and october["active_days"] == 2
    assert october["connect_rate"] == 40.0 and october["empty_rate"] == 25.0
    assert october["parties_per_conference"] == 20.0


def test_movers_compare_attended_minutes_on_the_same_days():
    rows = [_day(date(2026, 10, 3), 1, attended=500), _day(date(2026, 9, 3), 1, attended=200),
            _day(date(2026, 9, 20), 1, attended=9999)]
    [account] = insights.movers(rows, date(2026, 10, 10))["accounts"]
    assert (account["current"], account["previous"], account["change"]) == (500, 200, 300)


def test_conference_habits_read_room_length_and_start():
    as_of = date(2026, 10, 26)
    rows = [_day(date(2026, 10, 20), 7, conferences=3, connected=30), _day(date(2026, 10, 21), 7, conferences=1, connected=10)]
    times = [
        {"day": date(2026, 10, 20), "start_s": 9 * 3600, "end_s": 9 * 3600 + 20 * 60},
        {"day": date(2026, 10, 20), "start_s": 10 * 3600, "end_s": 10 * 3600 + 40 * 60},
        {"day": date(2026, 10, 21), "start_s": 23 * 3600 + 50 * 60, "end_s": 10 * 60},  # past midnight
    ]
    h = insights.habits(rows, times, as_of)
    assert h["conferences_per_active_day"] == 2.0 and h["parties_per_conference"] == 10.0
    assert h["median_length_minutes"] == 20 and h["usual_start"] == "10:00"
