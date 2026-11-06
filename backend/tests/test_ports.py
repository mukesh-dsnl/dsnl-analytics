"""Port Analyzer: the +1/-1 sweep over a hand-made day."""

from datetime import date, datetime, time

import duckdb
import pytest

from app.cdr import ports

DAY = date(2026, 11, 3)


def at(h, m, s=0):
    return datetime(2026, 11, 3, h, m, s)


@pytest.fixture
def day(monkeypatch):
    con = duckdb.connect()
    con.execute(
        "CREATE TABLE slice (service VARCHAR, provider VARCHAR, account VARCHAR, location VARCHAR,"
        " direction VARCHAR, s TIMESTAMP, r TIMESTAMP, ok BOOLEAN)"
    )
    calls = [
        # service, provider, account, start, release
        ("voicedrop", "15", "100", at(9, 0), at(9, 30)),
        ("voicedrop", "15", "100", at(9, 10), at(9, 20)),
        ("conference", "22", "200", at(9, 15), at(10, 30)),  # still running when 10:00 opens
        ("conference", "22", "300", at(9, 20), at(9, 25)),  # releases exactly as another starts
        ("conference", "22", "300", at(9, 25), at(9, 40)),
    ]
    con.executemany(
        "INSERT INTO slice VALUES (?, ?, ?, '1', 'Dial Out', ?, ?, TRUE)",
        [(svc, prov, acct, s, r) for svc, prov, acct, s, r in calls],
    )
    monkeypatch.setattr(ports, "_slice", lambda d, svc: ports._Slice(con, len(calls)))
    monkeypatch.setattr(ports.directory, "accounts", lambda: {100: "Acme"})
    return con


def run(**overrides):
    args = dict(day=DAY, service="all", time_from=time(9, 0), time_to=time(10, 59, 59), resolution="5m",
                group_by="none", providers=[], accounts=[], locations=[], top=8, capacity=None)
    args.update(overrides)
    return ports.analyze(**args)


def test_the_peak_counts_overlaps_with_releases_before_starts(day):
    result = run()
    # 09:15: the 09:00, 09:10 and 09:15 calls are all up — three. At 09:20 one
    # releases as another starts, and at 09:25 again: still three, never four.
    assert result["summary"]["peak"] == 3
    assert result["summary"]["peak_at"].startswith("2026-11-03 09:15")
    assert result["labels"][:3] == ["09:00:00", "09:05:00", "09:10:00"]


def test_a_window_counts_the_calls_already_running(day):
    result = run(time_from=time(10, 0), time_to=time(10, 59, 59), resolution="15m")
    # Only the conference started at 09:15 is up from 10:00 to 10:30.
    assert result["total"] == [1, 1, 0, 0]
    assert result["summary"]["peak"] == 1
    assert result["summary"]["calls"] == 0  # none started inside the window
    assert result["summary"]["avg_ports"] == 0.5  # 30 port-minutes over 60 minutes


def test_groups_are_swept_on_their_own(day):
    result = run(group_by="service")
    peaks = {g["label"]: g["peak"] for g in result["groups"]}
    assert peaks == {"Voicedrop": 2, "Conference": 2}


def test_the_biggest_groups_are_named_and_the_rest_folded(day):
    result = run(group_by="account", top=1)
    labels = [g["label"] for g in result["groups"]]
    assert labels[-1] == "Other" and len(labels) == 2
    assert result["groups"][0]["label"] in ("100 · Acme", "300")


def test_filters_and_who_held_ports_at_the_peak(day):
    result = run(providers=["15"])
    assert result["summary"]["peak"] == 2
    held = {row["key"]: row["ports"] for row in result["at_peak"]["service_provider"]}
    assert held == {"15": 2}


def test_time_above_capacity(day):
    result = run(capacity=2)
    # Three ports from 09:15 until the 09:00 call releases at 09:30.
    assert result["summary"]["above_capacity_seconds"] == 900


def test_too_many_points_is_refused(day):
    with pytest.raises(ports.PortQueryError):
        run(time_from=time(0), time_to=time(23, 59, 59), resolution="1s")
