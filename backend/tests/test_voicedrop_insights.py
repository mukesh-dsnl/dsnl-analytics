"""Voicedrop Summary: the arithmetic over voicedrop_summary's per-day rows."""

from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.api import summary
from app.cdr import voicedrop_insights as insights
from app.cdr import voicedrop_summary


def row(day, account_id, campaigns=1, phones=100, dnd=10, connected=30, not_connected=60, minutes=30, unblast=0):
    return {
        "day": day,
        "account_id": account_id,
        "campaigns": campaigns,
        "phone_numbers": phones,
        "dnd": dnd,
        "dialout": connected + not_connected,
        "connected": connected,
        "not_connected": not_connected,
        "dialed": connected + not_connected,
        "minutes": minutes,
        "unblast": unblast,
    }


def test_monthly_totals_fold_days_and_rate_against_dialed():
    rows = [row(date(2026, 9, 1), 1), row(date(2026, 9, 2), 1, connected=60, not_connected=30), row(date(2026, 10, 1), 1)]
    months = insights.monthly_totals(rows)
    assert [m["month"] for m in months] == ["2026-09", "2026-10"]
    september = months[0]
    assert september["active_days"] == 2 and september["dialed"] == 180
    assert september["connect_rate"] == 50.0  # 90 connected of 180 dialed
    assert september["dnd_rate"] == 10.0


def test_movers_compare_the_same_days_of_last_month():
    as_of = date(2026, 10, 10)
    rows = [
        row(date(2026, 10, 5), 1, connected=100, not_connected=0),
        row(date(2026, 9, 5), 1, connected=50, not_connected=0),
        # After the 10th of September: outside the comparison window.
        row(date(2026, 9, 20), 1, connected=1000, not_connected=0),
        row(date(2026, 9, 6), 2, connected=40, not_connected=0),
    ]
    result = insights.movers(rows, as_of)
    assert (result["previous_from"], result["previous_to"]) == ("2026-09-01", "2026-09-10")
    by_id = {a["account_id"]: a for a in result["accounts"]}
    assert by_id[1]["change"] == 50 and by_id[1]["change_pct"] == 100.0
    assert by_id[2]["current_dialed"] == 0 and by_id[2]["change"] == -40
    assert [a["account_id"] for a in result["accounts"]] == [1, 2]


def test_previous_span_clamps_to_a_shorter_month():
    _, _, start, end = insights._previous_month_span(date(2026, 3, 31))
    assert (start, end) == (date(2026, 2, 1), date(2026, 2, 28))


def test_accounts_report_idle_days_and_their_recent_volume():
    as_of = date(2026, 10, 26)
    last = as_of - timedelta(days=20)
    rows = [
        row(last, 7, connected=10, not_connected=0),
        row(last - timedelta(days=30), 7, connected=5, not_connected=0),
        # More than 90 days before its last day: not part of "what it used to send".
        row(last - timedelta(days=120), 7, connected=1000, not_connected=0),
    ]
    [account] = insights.account_list(rows, {7: [70]}, as_of)
    assert account["days_idle"] == 20
    assert account["dialed_last_90_active"] == 15
    assert account["dialed"] == 1015 and account["client_ids"] == [70]


def test_the_tables_first_month_is_flagged_not_counted_as_new():
    rows = [row(date(2026, 3, 6), 1), row(date(2026, 4, 2), 2), row(date(2026, 3, 9), 2)]
    months = insights.new_accounts(rows, date(2026, 3, 6))
    assert months == [{"month": "2026-03", "accounts": [1, 2], "is_table_start": True}]


def test_habits_read_the_last_90_days():
    as_of = date(2026, 10, 26)
    rows = [
        row(date(2026, 10, 20), 5, campaigns=3, phones=300),
        row(date(2026, 10, 21), 5, campaigns=1, phones=100),
        row(date(2026, 9, 2), 5, campaigns=2, phones=200),
        row(date(2026, 1, 2), 5, campaigns=50, phones=50000),
    ]
    starts = [
        {"day": date(2026, 10, 20), "seconds": 9 * 3600},
        {"day": date(2026, 10, 20), "seconds": 10 * 3600 + 30 * 60},
        {"day": date(2026, 10, 21), "seconds": 10 * 3600},
        {"day": date(2026, 1, 2), "seconds": 23 * 3600},
    ]
    h = insights.habits(rows, starts, as_of)
    assert h["scope"] == "90d"
    assert h["active_days_this_month"] == 2 and h["active_days_last_month"] == 1
    assert h["campaigns_per_active_day"] == 2.0  # 6 campaigns over 3 days
    assert h["avg_campaign_size"] == 100
    assert h["usual_start"] == "10:00" and h["busiest_hour"] == 10
    assert h["days_since_active"] == 5


def test_statement_month_must_be_yyyy_mm_and_a_missing_source_is_503(monkeypatch):
    with pytest.raises(HTTPException) as exc:
        summary.summary_statement(month="2026-13")
    assert exc.value.status_code == 400

    def unconfigured(*_):
        raise voicedrop_summary.SourceNotConfigured("Set VOICEDROP_SUMMARY_DATABASE_URL")

    monkeypatch.setattr(insights, "overview", unconfigured)
    with pytest.raises(HTTPException) as exc:
        summary.summary_overview()
    assert exc.value.status_code == 503


def test_an_unknown_account_is_404(monkeypatch):
    monkeypatch.setattr(insights, "account", lambda account_id, client=None: None)
    with pytest.raises(HTTPException) as exc:
        summary.summary_account(1, None)
    assert exc.value.status_code == 404
