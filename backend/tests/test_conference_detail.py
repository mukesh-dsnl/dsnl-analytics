"""Conference › Campaigns details panel: one room from a hand-made day's CODR and CDR."""

from datetime import date

import duckdb
import pytest

from app.cdr import conference_detail

DAY = date(2026, 11, 5)


@pytest.fixture
def lake(tmp_path, monkeypatch):
    codr = tmp_path / "codr_20261105.parquet"
    cdr = tmp_path / "cdr_20261105.parquet"
    con = duckdb.connect()
    con.execute(f"""
        COPY (SELECT * FROM (VALUES
            (500, 'ACME CODR NAME', 7, 'Client CODR', 'Board call', TIMESTAMP '2026-11-05 10:00:00',
             TIMESTAMP '2026-11-05 10:25:30', 1793800000, 1793801530, 746268, '1793846785', 4242, 'Chair Booked', 1),
            (500, 'ACME CODR NAME', 7, 'Client CODR', 'Other room', TIMESTAMP '2026-11-05 11:00:00',
             TIMESTAMP '2026-11-05 11:10:00', 1793803600, 1793804200, 746268, '1793846999', 4242, 'Chair Booked', 1)
        ) t(ACCOUNT_ID, ACCOUNT_NAME, CLIENT_ID, CLIENT_NAME, CONFERENCE_NAME, START_DATETIME, END_DATETIME,
            START_DATETIME_EPOC, END_DATETIME_EPOC, CRN, CONF_NUM, CHAIR_PIN, CHAIR_NAME, MODULE_TYPE))
        TO '{codr}' (FORMAT PARQUET)
    """)
    con.execute(f"""
        COPY (SELECT * FROM (VALUES
            -- The same chairperson twice (a dropped line): one line, two legs, joined.
            (746268, '1793846785', 1, 1, 'Ravi', NULL, '9800000001', 8044000000.0, TIMESTAMP '2026-11-05 10:01:00', TIMESTAMP '2026-11-05 10:01:20'),
            (746268, '1793846785', 1, 1, 'Ravi', NULL, '9800000001', 8044000000.0, TIMESTAMP '2026-11-05 10:05:00', NULL),
            -- A dial-out chair, never joined; its number is in TEL_DIGIT.
            (746268, '1793846785', 1, 0, 'Meena', NULL, '9800000002', NULL, TIMESTAMP '2026-11-05 10:02:00', NULL),
            -- A participant (not a chair) on a second DID.
            (746268, '1793846785', 2, 1, 'Guest', '9800000003', NULL, 8044000001.0, TIMESTAMP '2026-11-05 10:03:00', TIMESTAMP '2026-11-05 10:03:10'),
            -- Another room of the same CRN: left out.
            (746268, '1793846999', 1, 1, 'Elsewhere', NULL, '9800000009', 8044000009.0, TIMESTAMP '2026-11-05 11:01:00', NULL)
        ) t(CRN, CONF_NUM, CONFEREE_TYPE, CALLTYPE, CONFEREE_NAME, CLI, TEL_DIGIT, DID, START_DATETIME, INCONFERENCE))
        TO '{cdr}' (FORMAT PARQUET)
    """)
    files = {"codr": [codr], "cdr": [cdr]}
    monkeypatch.setattr(conference_detail.lake, "files_for_range", lambda kind, a, b: files[kind] if a == DAY else [])
    monkeypatch.setattr(conference_detail.directory, "account_name", lambda account_id: "Acme Master")
    monkeypatch.setattr(conference_detail.directory, "clients", lambda: {})
    return files


def test_the_room_reads_its_booking_from_codr(lake):
    room = conference_detail.detail(DAY, 500, 746268, "1793846785")
    assert room["account_name"] == "Acme Master"  # the master list wins
    assert room["client_name"] == "Client CODR"  # no master name: CODR's
    assert room["conference_name"] == "Board call"
    assert (room["start_time"], room["end_time"]) == ("10:00:00", "10:25:30")
    assert room["room_duration_mins"] == 26  # 25.5 minutes, rounded up
    assert room["chair_pin"] == 4242
    assert room["conf_num"] == "1793846785"


def test_chairpersons_fold_their_legs_and_dids_are_this_room_only(lake):
    room = conference_detail.detail(DAY, 500, 746268, "1793846785")
    assert room["dids"] == [8044000000, 8044000001]
    assert [(c["name"], c["phone"], c["legs"], c["joined"]) for c in room["chairpersons"]] == [
        ("Ravi", "9800000001", 2, True),
        ("Meena", "9800000002", 1, False),
    ]


def test_an_unknown_room_is_none(lake):
    assert conference_detail.detail(DAY, 500, 746268, "nope") is None
    assert conference_detail.detail(DAY, 999, 746268, "1793846785") is None
