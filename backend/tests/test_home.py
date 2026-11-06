"""Home: the three-service cards."""

from datetime import date

from app.api import home


def test_a_card_reads_its_latest_day_month_and_bars():
    rows = [
        {"day": date(2026, 10, 31), "account_id": 1, "campaigns": 2, "dialout": 100, "connected": 40, "minutes": 30},
        {"day": date(2026, 11, 1), "account_id": 1, "campaigns": 1, "dialout": 50, "connected": 10, "minutes": 5},
        {"day": date(2026, 11, 2), "account_id": 2, "campaigns": 3, "dialout": 200, "connected": 100, "minutes": 60},
        {"day": date(2026, 11, 2), "account_id": 1, "campaigns": 1, "dialout": 0, "connected": 0, "minutes": 0},
    ]
    card = home._card(rows, units="campaigns", total="dialout", connected="connected", minutes="minutes")
    assert card["as_of"] == "2026-11-02"
    assert card["day"] == {"units": 4, "total": 200, "connected": 100, "minutes": 60, "accounts": 2, "connect_rate": 50.0, "days": 1}
    # The month so far: 1 and 2 November, not 31 October.
    assert card["period"]["total"] == 250 and card["period"]["accounts"] == 2 and card["period"]["days"] == 2
    assert [b["date"] for b in card["series"]] == ["2026-10-31", "2026-11-01", "2026-11-02"]


def test_an_unreadable_service_reports_its_own_error():
    def broken():
        raise RuntimeError("share offline")

    assert home._safely("multicall", broken) == {"as_of": None, "error": "share offline"}
