"""Long ranges in one call: windowed results equal one query over the range,
distinct counts stay exact across windows, and the Voicedrop report matches
the reporting team's query."""

import json
from datetime import date, timedelta

import duckdb
import pytest

from app.ai import commands
from app.ai.tools import ad_hoc_sql, metrics, voicedrop_report
from app.ai.tools.windows import split
from app.cdr import lake
from app.core.config import get_settings

# ── Window splitting ───────────────────────────────────────────────────────


def test_windows_cover_the_range_exactly_once():
    windows = split(date(2026, 9, 1), date(2026, 9, 30), 5)
    assert windows[0] == (date(2026, 9, 1), date(2026, 9, 5))
    assert windows[-1] == (date(2026, 9, 26), date(2026, 9, 30))
    days = [w[0] + timedelta(days=i) for w in windows for i in range((w[1] - w[0]).days + 1)]
    assert days == [date(2026, 9, 1) + timedelta(days=i) for i in range(30)]


def test_a_partial_last_window_and_a_single_day():
    assert split(date(2026, 9, 1), date(2026, 9, 7), 5)[-1] == (date(2026, 9, 6), date(2026, 9, 7))
    assert split(date(2026, 9, 1), date(2026, 9, 1), 5) == [(date(2026, 9, 1), date(2026, 9, 1))]


# ── A two-day lake with the report's columns ───────────────────────────────

DAY1, DAY2 = date(2026, 9, 1), date(2026, 9, 2)

# (day, crn, seq, account, calltype, cli, tel_digit, connected, seconds)
LEGS = [
    # Campaign 501 on day 1: number A twice (one retry connects), B never.
    (DAY1, 501, 1, 7001, 1, None, "9000000001", False, 0),
    (DAY1, 501, 1, 7001, 1, None, "9000000001", True, 40),
    (DAY1, 501, 2, 7001, 1, None, "9000000002", False, 0),
    # Campaign 502 on day 2: number A again (a repeat across windows), C.
    (DAY2, 502, 1, 7001, 1, None, "9000000001", True, 12),
    (DAY2, 502, 2, 7001, 1, None, "9000000003", False, 0),
    # Another account, and a dial-in leg (CLI is the phone for CALLTYPE 0).
    (DAY2, 601, 1, 7002, 0, "9000000004", None, True, 1),
]


@pytest.fixture
def two_day_lake(tmp_path, monkeypatch):
    cdr_dir, codr_dir = tmp_path / "cdr", tmp_path / "codr"
    cdr_dir.mkdir()
    codr_dir.mkdir()
    con = duckdb.connect()
    for day in (DAY1, DAY2):
        rows = []
        for n, (d, crn, seq, account, calltype, cli, tel, connected, secs) in enumerate(LEGS):
            if d != day:
                continue
            start = f"TIMESTAMP '{d} 10:00:{n:02d}'"
            inconf = 1_788_000_000 + n * 100 if connected else 0
            rows.append(
                f"(DATE '{d}', {crn}, '{crn}', {seq}, {account}, 6, {calltype}, 1, 'SP', 1, 31, 0, 0,"
                f" {start}, {'NULL' if not connected else start}, {inconf}, {inconf + secs if connected else 0},"
                f" {inconf + secs if connected else 0}, CAST({('NULL' if tel is None else repr(tel))} AS VARCHAR),"
                f" CAST({('NULL' if cli is None else repr(cli))} AS VARCHAR), NULL)"
            )
        con.execute(f"""
            COPY (SELECT * FROM (VALUES {", ".join(rows)}) AS t(
                CALL_DATE, CRN, CONF_NUM, CONFEREE_SEQ_NO, ACCOUNTID, CONFEREE_TYPE, CALLTYPE,
                LOCATION_ID, SERVICE_PROVIDER, PORT, DISCONNECT_REASON, AID_COUNT,
                CONFDIAL_REBLAST_COUNT, START_DATETIME, INCONFERENCE, INCONF_DATETIME_EPOC,
                DISCONNECT_DATETIME_EPOC, RELEASE_DATETIME_EPOC, TEL_DIGIT, CLI, DTMFDIGITS))
            TO '{(cdr_dir / f"cdr_{day:%Y%m%d}.parquet").as_posix()}' (FORMAT PARQUET)""")
        con.execute(f"""
            COPY (SELECT 501 AS CRN, '501' AS CONF_NUM, 3 AS MODULE_TYPE, '7001' AS ACCOUNT_ID)
            TO '{(codr_dir / f"codr_{day:%Y%m%d}.parquet").as_posix()}' (FORMAT PARQUET)""")
    con.close()

    settings = get_settings()
    monkeypatch.setattr(settings, "CDR_LAKE_PATH", str(cdr_dir))
    monkeypatch.setattr(settings, "CODR_LAKE_PATH", str(codr_dir))
    monkeypatch.setattr(settings, "AI_DUCKDB_TEMP_DIR", str(tmp_path / "spill"))
    lake.forget_listings()
    yield cdr_dir
    lake.forget_listings()


def _metrics(window_days, monkeypatch, **args):
    monkeypatch.setattr(get_settings(), "AI_WINDOW_DAYS", window_days)
    content, error = metrics.query_metrics(date_from=str(DAY1), date_to=str(DAY2), **args)
    assert not error, content
    return json.loads(content)


@pytest.mark.parametrize("group_by", [None, ["date"], ["account"], ["account", "date"]])
def test_windowed_metrics_equal_one_query_over_the_range(two_day_lake, monkeypatch, group_by):
    measures = ["calls", "connected", "not_connected", "connect_rate", "minutes",
                "phone_numbers", "conferences", "accounts"]
    single = _metrics(30, monkeypatch, measures=measures, group_by=group_by)
    windowed = _metrics(1, monkeypatch, measures=measures, group_by=group_by)
    key = lambda r: json.dumps(r, sort_keys=True)  # noqa: E731
    assert sorted(map(key, single["rows"])) == sorted(map(key, windowed["rows"]))
    assert "notes" in windowed and "notes" not in single


def test_a_number_dialled_in_two_windows_is_counted_once(two_day_lake, monkeypatch):
    # 9000000001 is dialled on both days: 4 distinct numbers, not 5.
    row = _metrics(1, monkeypatch, measures=["phone_numbers", "calls"])["rows"][0]
    assert row == {"phone_numbers": 4, "calls": 6}


# ── The Voicedrop report ───────────────────────────────────────────────────


def _report(**args):
    content, error = voicedrop_report.voicedrop_report(date_from=str(DAY1), date_to=str(DAY2), **args)
    assert not error, content
    return json.loads(content)


def test_report_collapses_retries_into_one_row_per_number(two_day_lake, monkeypatch):
    monkeypatch.setattr(get_settings(), "AI_WINDOW_DAYS", 1)
    report = _report(account_id="7001")
    rows = {(r["crn"], r["phone_number"]): r for r in report["rows"]}
    assert rows[(501, "9000000001")]["status"] == "Connected"
    assert rows[(501, "9000000001")]["total_attempts"] == 2
    assert rows[(501, "9000000001")]["total_duration_secs"] == 40
    assert rows[(501, "9000000002")]["status"] == "Not Connected"
    assert report["totals"] == {
        "numbers": 4, "connected": 2, "not_connected": 2,
        "total_duration_secs": 52, "total_attempts": 5, "campaigns": 2,
    }


def test_report_matches_the_reporting_teams_query(two_day_lake):
    """The exact SQL the report is built from, run by hand, gives the same rows."""
    files = [p.as_posix() for p in sorted(two_day_lake.glob("*.parquet"))]
    theirs = duckdb.connect().execute(f"""
        SELECT CRN, call_date,
            MAX(CASE WHEN CALLTYPE = 0 THEN CLI ELSE TEL_DIGIT END) AS PHONE_NUMBER,
            CASE WHEN MAX(CASE WHEN INCONFERENCE IS NOT NULL THEN 1 ELSE 0 END) = 1
                THEN 'Connected' ELSE 'Not Connected' END AS STATUS,
            SUM(CASE WHEN INCONFERENCE IS NULL THEN 0
                ELSE GREATEST(DISCONNECT_DATETIME_EPOC - INCONF_DATETIME_EPOC, 1) END) AS TOTAL_DURATION_SECS,
            count(*) as TOTAL_ATTEMPTS
        FROM read_parquet({files})
        WHERE CRN IN (501, 502, 601)
        GROUP BY CRN, CALL_DATE, CONFEREE_SEQ_NO
        ORDER BY CALL_DATE, CRN, CONFEREE_SEQ_NO""").fetchall()
    with voicedrop_report.export_rows({"date_from": str(DAY1), "date_to": str(DAY2)}, 1000) as data:
        ours = [row for batch in data.batches for row in batch]
    assert ours == theirs


def test_report_filters(two_day_lake):
    assert _report(status="connected")["totals"]["numbers"] == 3
    assert _report(status="not_connected")["totals"]["numbers"] == 2
    assert _report(crns=["502"])["totals"]["numbers"] == 2
    assert _report(phone_numbers=["+91 90000 00001"])["totals"]["numbers"] == 2  # last 10 digits
    assert _report(account_id="7002")["rows"][0]["phone_number"] == "9000000004"  # CLI for dial-in


def test_report_rejects_bad_input(two_day_lake):
    content, error = voicedrop_report.voicedrop_report(date_from="2026-09-02", date_to="2026-09-01")
    assert error and "before" in content
    content, error = voicedrop_report.voicedrop_report(date_from=str(DAY1), date_to=str(DAY2), crns=["50x"])
    assert error and "numbers" in content


def test_report_command_is_not_read_as_the_voicedrop_scope():
    parsed = commands.parse("/voicedrop-report /excel campaign 501")
    assert parsed.commands == ["voicedrop-report", "excel"] and parsed.wants_report
    assert parsed.scopes == []
    assert "voicedrop_report tool" in commands.instructions(parsed)


# ── Ad-hoc SQL reads only the columns it uses ──────────────────────────────


def test_only_mentioned_columns_are_materialised(two_day_lake):
    files = sorted(two_day_lake.glob("*.parquet"))
    con = duckdb.connect()
    projection = ad_hoc_sql._columns_for(con, files, "SELECT ACCOUNTID, COUNT(*) FROM cdr GROUP BY 1", ad_hoc_sql._CDR_ALWAYS)
    assert set(projection.replace('"', "").split(", ")) == {"ACCOUNTID", "CALL_DATE", "START_DATETIME", "CRN", "CONF_NUM"}
    assert ad_hoc_sql._columns_for(con, files, "SELECT * FROM cdr", ad_hoc_sql._CDR_ALWAYS) == "*"
    assert ad_hoc_sql._columns_for(con, files, "SELECT c.* FROM cdr c", ad_hoc_sql._CDR_ALWAYS) == "*"
    # COUNT(*) is not "every column".
    assert ad_hoc_sql._columns_for(con, files, "SELECT COUNT(*) FROM cdr", ad_hoc_sql._CDR_ALWAYS) != "*"


def test_pruned_sql_gives_the_same_answer(two_day_lake, monkeypatch):
    args = {"date_from": str(DAY1), "date_to": str(DAY2), "purpose": "t",
            "sql": "SELECT ACCOUNTID, COUNT(*) AS n FROM cdr GROUP BY 1 ORDER BY 1"}
    pruned = ad_hoc_sql.run_cdr_query(**args)
    monkeypatch.setattr(ad_hoc_sql, "_columns_for", lambda *a, **k: "*")
    assert ad_hoc_sql.run_cdr_query(**args) == pruned


def test_a_column_typed_differently_on_different_days_does_not_break_a_range(two_day_lake):
    """The real lake has this: ARNCODE is all-empty (typed NULL) in one day's
    file and VARCHAR in the next, which made reading both days fail."""
    con = duckdb.connect()
    for day, value in ((DAY1, "NULL"), (DAY2, "'X1'")):
        path = (two_day_lake / f"cdr_{day:%Y%m%d}.parquet").as_posix()
        con.execute(f"COPY (SELECT *, {value} AS ARNCODE FROM read_parquet('{path}')) TO '{path}.tmp' (FORMAT PARQUET)")
    con.close()
    for day in (DAY1, DAY2):
        path = two_day_lake / f"cdr_{day:%Y%m%d}.parquet"
        path.unlink()
        path.with_name(path.name + ".tmp").rename(path)
    lake.forget_listings()

    content, error = ad_hoc_sql.run_cdr_query(
        date_from=str(DAY1), date_to=str(DAY2), purpose="t", sql="SELECT * FROM cdr")
    assert not error, content
    assert json.loads(content)["row_count"] == 6
    content, error = metrics.query_metrics(date_from=str(DAY1), date_to=str(DAY2), measures=["calls"])
    assert not error and json.loads(content)["rows"][0]["calls"] == 6
