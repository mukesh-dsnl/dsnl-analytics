"""
Tests for the measures-by-dimensions tool.

Runs against the fixture lake from conftest.py, so every expected figure is
hand-countable from the six legs defined there. No network.

The most important test in this file is
`test_a_multi_day_series_is_one_call`: that shape — a figure per day across a
range wider than the dashboard's own ceiling — is the exact question that used
to be unanswerable, because minutes existed only as a whole-range total and the
model could reach a per-day figure only by calling once per day.
"""

import json
from datetime import timedelta

import pytest

from app.ai.tools.metrics import DIMENSIONS, MEASURES, query_metrics
from app.core.config import get_settings


def run(**kwargs) -> dict:
    """Call the tool and return the decoded payload, failing on an error result."""
    content, is_error = query_metrics(**kwargs)
    assert not is_error, f"unexpected error: {content}"
    return json.loads(content)


# ── Totals, ungrouped ──────────────────────────────────────────────────────


def test_totals_with_no_grouping_are_one_row(fixture_lake):
    day = fixture_lake.isoformat()
    payload = run(
        date_from=day,
        date_to=day,
        measures=["calls", "connected", "not_connected", "minutes", "conferences"],
    )

    assert payload["row_count"] == 1
    row = payload["rows"][0]
    # Six legs, four of them connected — see tests/conftest.py.
    assert row["calls"] == 6
    assert row["connected"] == 4
    assert row["not_connected"] == 2
    # Each connected leg holds 120 seconds = 2 minutes.
    assert row["minutes"] == 8
    # Rooms are (101,1) (101,2) (101,3) (202,1) (202,2) (303,1).
    assert row["conferences"] == 6


def test_connect_rate_is_a_percentage(fixture_lake):
    day = fixture_lake.isoformat()
    row = run(date_from=day, date_to=day, measures=["connect_rate"])["rows"][0]
    assert row["connect_rate"] == pytest.approx(66.67, abs=0.01)  # 4 of 6


def test_defaults_to_calls_connected_and_rate(fixture_lake):
    day = fixture_lake.isoformat()
    payload = run(date_from=day, date_to=day)
    assert set(payload["rows"][0]) == {"calls", "connected", "connect_rate"}


# ── Grouping ───────────────────────────────────────────────────────────────


def test_group_by_account(fixture_lake):
    day = fixture_lake.isoformat()
    payload = run(
        date_from=day, date_to=day, measures=["calls", "connected"], group_by=["account"]
    )

    by_account = {r["account"]: r for r in payload["rows"]}
    assert by_account["4021"]["calls"] == 3
    assert by_account["4021"]["connected"] == 2
    assert by_account["5000"]["calls"] == 2
    assert by_account["6000"]["calls"] == 1


def test_group_by_service_type_joins_codr(fixture_lake):
    """MODULE_TYPE lives on CODR, so this grouping must force the join."""
    day = fixture_lake.isoformat()
    payload = run(date_from=day, date_to=day, measures=["calls"], group_by=["service_type"])

    by_type = {r["service_type"]: r["calls"] for r in payload["rows"]}
    assert by_type["voicedrop"] == 3
    assert by_type["conference"] == 2
    assert by_type["multicall"] == 1


def test_group_by_direction(fixture_lake):
    day = fixture_lake.isoformat()
    payload = run(date_from=day, date_to=day, measures=["calls"], group_by=["direction"])
    by_direction = {r["direction"]: r["calls"] for r in payload["rows"]}
    # CALLTYPE 1 is Dial Out — four of the six legs.
    assert by_direction["Dial Out"] == 4
    assert by_direction["Dial In"] == 2


def test_two_dimensions_cross_tabulate(fixture_lake):
    day = fixture_lake.isoformat()
    payload = run(
        date_from=day, date_to=day, measures=["calls"], group_by=["account", "direction"]
    )
    assert payload["group_by"] == ["account", "direction"]
    for row in payload["rows"]:
        assert "account" in row and "direction" in row


def test_disconnect_reasons_come_back_as_labels(fixture_lake):
    """Raw codes are meaningless in an answer; they are mapped as the charts map them."""
    day = fixture_lake.isoformat()
    payload = run(
        date_from=day, date_to=day, measures=["calls"], group_by=["disconnect_reason"]
    )
    labels = {r["disconnect_reason"] for r in payload["rows"]}
    assert labels
    assert all(not label.isdigit() for label in labels)


# ── The shape that used to be unanswerable ─────────────────────────────────


def test_a_multi_day_series_is_one_call(fixture_lake):
    """A per-day figure across a range wider than the dashboard's own ceiling.

    This is the regression: the range exceeds CDR_MAX_RANGE_DAYS, and the
    measure (minutes) had no per-day panel, so the only previous route to this
    answer was one call per day.
    """
    settings = get_settings()
    start = fixture_lake - timedelta(days=settings.CDR_MAX_RANGE_DAYS + 3)

    payload = run(
        date_from=start.isoformat(),
        date_to=fixture_lake.isoformat(),
        measures=["minutes", "calls"],
        group_by=["date"],
    )

    # Only the fixture's own day has rows; the point is that the call is
    # accepted at all and returns the day as a row rather than being rejected.
    assert payload["row_count"] == 1
    assert payload["rows"][0]["date"] == fixture_lake.isoformat()
    assert payload["rows"][0]["minutes"] == 8


def test_a_date_series_is_ordered_by_date_not_by_size(fixture_lake):
    payload = run(
        date_from=fixture_lake.isoformat(),
        date_to=fixture_lake.isoformat(),
        measures=["calls"],
        group_by=["date"],
    )
    dates = [r["date"] for r in payload["rows"]]
    assert dates == sorted(dates)


# ── Ordering and limits ────────────────────────────────────────────────────


def test_order_by_a_measure_ranks_largest_first(fixture_lake):
    day = fixture_lake.isoformat()
    payload = run(
        date_from=day,
        date_to=day,
        measures=["calls"],
        group_by=["account"],
        order_by="calls",
    )
    counts = [r["calls"] for r in payload["rows"]]
    assert counts == sorted(counts, reverse=True)


def test_limit_produces_a_top_n(fixture_lake):
    day = fixture_lake.isoformat()
    payload = run(
        date_from=day,
        date_to=day,
        measures=["calls"],
        group_by=["account"],
        order_by="calls",
        limit=1,
    )
    assert payload["row_count"] == 1
    assert payload["rows"][0]["account"] == "4021"
    assert payload["truncated"] is True


# ── Argument handling ──────────────────────────────────────────────────────


def test_accepts_comma_separated_strings(fixture_lake):
    """Models sometimes send "a,b" where the schema says array."""
    day = fixture_lake.isoformat()
    payload = run(date_from=day, date_to=day, measures="minutes,calls", group_by="date")
    assert set(payload["rows"][0]) == {"date", "minutes", "calls"}


def test_service_filter_narrows_the_result(fixture_lake):
    day = fixture_lake.isoformat()
    payload = run(date_from=day, date_to=day, measures=["calls"], service="voicedrop")
    assert payload["rows"][0]["calls"] == 3
    assert payload["service"] == "voicedrop"


# ── Errors the model has to be able to act on ──────────────────────────────


def test_rejects_an_unknown_measure(fixture_lake):
    content, is_error = query_metrics(
        date_from=fixture_lake.isoformat(), date_to=fixture_lake.isoformat(), measures=["revenue"]
    )
    assert is_error is True
    assert "revenue" in content
    assert "calls" in content  # the message lists what is available


def test_rejects_an_unknown_dimension(fixture_lake):
    content, is_error = query_metrics(
        date_from=fixture_lake.isoformat(), date_to=fixture_lake.isoformat(), group_by=["country"]
    )
    assert is_error is True
    assert "country" in content


def test_rejects_more_than_two_dimensions(fixture_lake):
    content, is_error = query_metrics(
        date_from=fixture_lake.isoformat(),
        date_to=fixture_lake.isoformat(),
        group_by=["date", "account", "location"],
    )
    assert is_error is True
    assert "2 dimensions" in content


def test_rejects_a_range_beyond_the_ai_ceiling(fixture_lake):
    settings = get_settings()
    content, is_error = query_metrics(
        date_from=(fixture_lake - timedelta(days=settings.AI_MAX_RANGE_DAYS + 5)).isoformat(),
        date_to=fixture_lake.isoformat(),
    )
    assert is_error is True
    assert str(settings.AI_MAX_RANGE_DAYS) in content


def test_reports_a_range_with_no_files(fixture_lake):
    missing = fixture_lake - timedelta(days=400)
    content, is_error = query_metrics(
        date_from=missing.isoformat(), date_to=missing.isoformat()
    )
    assert is_error is True
    assert "No CDR export files" in content


# ── The catalogue itself ───────────────────────────────────────────────────


def test_every_declared_measure_executes(fixture_lake):
    """A measure offered in the schema the model reads must actually run."""
    day = fixture_lake.isoformat()
    for measure in MEASURES:
        content, is_error = query_metrics(date_from=day, date_to=day, measures=[measure])
        assert not is_error, f"measure {measure} failed: {content}"


def test_every_declared_dimension_executes(fixture_lake):
    day = fixture_lake.isoformat()
    for dimension in DIMENSIONS:
        content, is_error = query_metrics(
            date_from=day, date_to=day, measures=["calls"], group_by=[dimension]
        )
        assert not is_error, f"dimension {dimension} failed: {content}"
