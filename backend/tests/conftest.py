"""
Shared fixtures for the AI chat tests.

The important one is `fixture_lake`: a real two-file parquet lake on disk with
the settings pointed at it. Both the orchestrator tests and the live Gemini
test need it, and both need it to carry *every* column the dashboard panels
project — the panel SQL selects a fixed column list, so a fixture missing one
fails with a binder error rather than an empty result.

The rows are chosen so a handful of questions have known, hand-checkable
answers:

    account 4021, voicedrop  — 3 legs, 2 connected  (CONFEREE_TYPE 6 / MODULE_TYPE 3)
    account 5000, conference — 2 legs, 1 connected  (CONFEREE_TYPE 2 / MODULE_TYPE 1)
    account 6000, multicall  — 1 leg,  1 connected  (MODULE_TYPE 4)
"""

from datetime import date, timedelta

import duckdb
import pytest

from app.cdr import lake
from app.core.config import get_settings

# (CRN, CONF_NUM, ACCOUNTID, CONFEREE_TYPE, CALLTYPE, connected, minute, number)
_LEGS = [
    (101, 1, 4021, 6, 1, True, 0, "9876543210"),
    (101, 2, 4021, 6, 1, True, 1, "9876543211"),
    (101, 3, 4021, 6, 1, False, 2, "9876543212"),
    (202, 1, 5000, 2, 0, True, 10, "9998887770"),
    (202, 2, 5000, 2, 0, False, 11, "9998887771"),
    (303, 1, 6000, 2, 1, True, 20, "9112223330"),
]

# (CRN, CONF_NUM, MODULE_TYPE, ACCOUNT_ID)
_ROOMS = [
    (101, 1, 3, "4021"),
    (101, 2, 3, "4021"),
    (101, 3, 3, "4021"),
    (202, 1, 1, "5000"),
    (202, 2, 1, "5000"),
    (303, 1, 4, "6000"),
]

# Known answers, asserted by the live test so it checks a figure rather than
# just that a call was made.
VOICEDROP_4021_CONNECTED = 2
VOICEDROP_4021_TOTAL = 3


def _cdr_row_sql(day: date, leg: tuple) -> str:
    """One VALUES row carrying every column the panel slice projects."""
    crn, conf_num, account, conferee_type, calltype, connected, minute, number = leg
    start = f"TIMESTAMP '{day.isoformat()} 10:{minute:02d}:00'"
    inconf = 1_700_000_000 + minute * 60 if connected else 0
    release = inconf + 120 if connected else 0
    # An unconnected leg still rings and still disconnects — that is what makes
    # the funnel panel meaningful, and 35 is Ringing_Not_Answered.
    reason = 33 if connected else 35
    end = f"TIMESTAMP '{day.isoformat()} 10:{minute + 2:02d}:00'"

    return (
        f"(DATE '{day.isoformat()}', {crn}, {conf_num}, {conf_num}, {account}, "
        f"{conferee_type}, {calltype}, 1, 1, 'IN{crn}', {reason}, 0, 0, "
        f"{'NULL' if calltype == 0 else f'{start}'}, "
        f"{'NULL' if calltype == 0 else f'{start}'}, "
        f"{start}, {end}, {end}, "
        f"{inconf}, {release}, '{number}', '{number}', '')"
    )


@pytest.fixture
def fixture_lake(tmp_path, monkeypatch):
    """A one-day CDR/CODR parquet lake, with settings pointed at it.

    Yields the day it holds. Dated yesterday rather than a fixed date so the
    range is always one the application would consider current.
    """
    cdr_dir = tmp_path / "cdr"
    codr_dir = tmp_path / "codr"
    cdr_dir.mkdir()
    codr_dir.mkdir()

    day = date.today() - timedelta(days=1)
    stamp = day.strftime("%Y%m%d")

    con = duckdb.connect()
    con.execute(
        f"""
        CREATE TABLE cdr_rows AS SELECT * FROM (VALUES
            {", ".join(_cdr_row_sql(day, leg) for leg in _LEGS)}
        ) AS t(CALL_DATE, CRN, CONF_NUM, CONFEREE_SEQ_NO, ACCOUNTID,
               CONFEREE_TYPE, CALLTYPE, LOCATION_ID, SERVICE_PROVIDER, PORT,
               DISCONNECT_REASON, AID_COUNT, CONFDIAL_REBLAST_COUNT,
               PROCEEDING, ALERT, START_DATETIME, DISCONNECT_DATETIME,
               RELEASE_DATETIME, INCONF_DATETIME_EPOC, RELEASE_DATETIME_EPOC,
               TEL_DIGIT, CLI, DTMFDIGITS)
        """
    )
    con.execute(
        f"COPY cdr_rows TO '{(cdr_dir / f'cdr_{stamp}.parquet').as_posix()}' (FORMAT PARQUET)"
    )

    con.execute(
        f"""
        CREATE TABLE codr_rows AS SELECT * FROM (VALUES
            {", ".join(str(room) for room in _ROOMS)}
        ) AS t(CRN, CONF_NUM, MODULE_TYPE, ACCOUNT_ID)
        """
    )
    con.execute(
        f"COPY codr_rows TO '{(codr_dir / f'codr_{stamp}.parquet').as_posix()}' (FORMAT PARQUET)"
    )
    con.close()

    settings = get_settings()
    monkeypatch.setattr(settings, "CDR_LAKE_PATH", str(cdr_dir))
    monkeypatch.setattr(settings, "CODR_LAKE_PATH", str(codr_dir))
    # The listing is cached for a few seconds; drop it either side so a real
    # lake configured in .env can't leak into these tests or vice versa.
    lake.forget_listings()
    yield day
    lake.forget_listings()
