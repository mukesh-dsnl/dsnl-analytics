"""
Unit tests for the model-written-SQL guard. No network, no DuckDB.

The guard is a denylist, so these tests are not a proof of safety — the real
backstop is DuckDB's filesystem lockdown in ad_hoc_sql.py, exercised in
test_ai_orchestrator.py. What is tested here is that the guard rejects the
things it claims to, accepts ordinary analytical SQL, and that its refusals
carry the self-correction hint the model needs.
"""

import pytest

from app.ai import sql_guard
from app.ai.sql_guard import SqlNotAllowed
from app.core.config import get_settings


# ── Accepts ordinary analytical SQL ────────────────────────────────────────


def test_accepts_a_plain_select():
    guarded = sql_guard.validate("SELECT COUNT(*) FROM cdr")
    assert "SELECT COUNT(*) FROM cdr" in guarded


def test_accepts_a_join_on_both_keys():
    sql = """
        SELECT o.MODULE_TYPE, COUNT(*) AS legs
        FROM cdr c
        JOIN codr o ON o.CRN = c.CRN AND o.CONF_NUM = c.CONF_NUM
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10
    """
    assert "MODULE_TYPE" in sql_guard.validate(sql)


def test_accepts_a_cte_and_its_later_reference():
    """A CTE defined in the statement is a legal FROM target."""
    sql = """
        WITH connected AS (
            SELECT ACCOUNTID FROM cdr WHERE INCONF_DATETIME_EPOC <> 0
        )
        SELECT ACCOUNTID, COUNT(*) FROM connected GROUP BY 1 ORDER BY 2 DESC
    """
    assert sql_guard.validate(sql)


def test_accepts_multiple_ctes():
    sql = """
        WITH a AS (SELECT CRN FROM cdr),
             b AS (SELECT CRN FROM codr)
        SELECT COUNT(*) FROM a JOIN b ON a.CRN = b.CRN
    """
    assert sql_guard.validate(sql)


def test_accepts_a_subquery_in_from():
    sql = "SELECT n FROM (SELECT COUNT(*) AS n FROM cdr) ORDER BY n"
    assert sql_guard.validate(sql)


def test_accepts_a_single_trailing_semicolon():
    """A statement terminator is a habit, not a second statement."""
    assert sql_guard.validate("SELECT 1 FROM cdr;")


def test_offset_is_not_mistaken_for_set():
    """The keyword check must respect word boundaries — OFFSET contains 'set'."""
    assert sql_guard.validate("SELECT CRN FROM cdr ORDER BY CRN LIMIT 5 OFFSET 10")


def test_a_forbidden_word_inside_a_string_literal_is_fine():
    """Only real keywords are forbidden, not the letters appearing in data."""
    assert sql_guard.validate(
        "SELECT COUNT(*) FROM cdr WHERE CONFEREE_NAME = 'drop table operator'"
    )


def test_a_forbidden_word_inside_a_comment_is_fine():
    assert sql_guard.validate("SELECT COUNT(*) FROM cdr -- do not attach anything")


# ── Rejects ────────────────────────────────────────────────────────────────


def test_rejects_empty_input():
    with pytest.raises(SqlNotAllowed):
        sql_guard.validate("")


def test_rejects_whitespace_only_input():
    with pytest.raises(SqlNotAllowed):
        sql_guard.validate("   \n  ")


def test_rejects_multi_statement_input():
    with pytest.raises(SqlNotAllowed, match="[Oo]nly one statement"):
        sql_guard.validate("SELECT 1 FROM cdr; DROP TABLE cdr")


def test_rejects_a_statement_that_does_not_start_with_select_or_with():
    with pytest.raises(SqlNotAllowed, match="SELECT or WITH"):
        sql_guard.validate("EXPLAIN SELECT * FROM cdr")


@pytest.mark.parametrize(
    "keyword,statement",
    [
        ("attach", "SELECT 1 FROM cdr WHERE 1 = (ATTACH 'x')"),
        ("detach", "SELECT 1 FROM cdr WHERE DETACH x"),
        ("copy", "SELECT 1 FROM cdr WHERE COPY x"),
        ("install", "SELECT 1 FROM cdr WHERE INSTALL httpfs"),
        ("load", "SELECT 1 FROM cdr WHERE LOAD httpfs"),
        ("pragma", "SELECT 1 FROM cdr WHERE PRAGMA database_list"),
        ("export", "SELECT 1 FROM cdr WHERE EXPORT DATABASE"),
        ("import", "SELECT 1 FROM cdr WHERE IMPORT DATABASE"),
        ("insert", "SELECT 1 FROM cdr WHERE INSERT INTO x"),
        ("update", "SELECT 1 FROM cdr WHERE UPDATE x"),
        ("delete", "SELECT 1 FROM cdr WHERE DELETE FROM x"),
        ("drop", "SELECT 1 FROM cdr WHERE DROP TABLE x"),
        ("create", "SELECT 1 FROM cdr WHERE CREATE TABLE x"),
        ("alter", "SELECT 1 FROM cdr WHERE ALTER TABLE x"),
        ("call", "SELECT 1 FROM cdr WHERE CALL x()"),
        ("set", "SELECT 1 FROM cdr WHERE SET disabled_filesystems=''"),
        ("reset", "SELECT 1 FROM cdr WHERE RESET disabled_filesystems"),
        ("read_parquet", "SELECT * FROM read_parquet('/etc/x')"),
        ("read_csv", "SELECT * FROM read_csv('/etc/passwd')"),
        ("read_json", "SELECT * FROM read_json('/etc/x')"),
        ("glob", "SELECT * FROM glob('*')"),
        ("parquet_scan", "SELECT * FROM parquet_scan('/etc/x')"),
        ("system", "SELECT 1 FROM cdr WHERE SYSTEM 'ls'"),
    ],
)
def test_rejects_each_forbidden_keyword(keyword, statement):
    with pytest.raises(SqlNotAllowed) as excinfo:
        sql_guard.validate(statement)
    # Every refusal must tell the model what to do instead, or it retries the
    # same shape and burns a round.
    assert "cdr" in str(excinfo.value).lower()


def test_keyword_check_is_case_insensitive():
    with pytest.raises(SqlNotAllowed):
        sql_guard.validate("SELECT * FROM ReAd_PaRqUeT('/etc/x')")


@pytest.mark.parametrize("path", ["/data/x.parquet", "c:/tmp/y.csv", "z:/lake/z.json"])
def test_rejects_anything_that_looks_like_a_file_path(path):
    with pytest.raises(SqlNotAllowed, match="file"):
        sql_guard.validate(f"SELECT * FROM cdr WHERE CONFEREE_NAME = {path}")


def test_rejects_an_unknown_from_target():
    with pytest.raises(SqlNotAllowed, match="not a table"):
        sql_guard.validate("SELECT * FROM users")


def test_rejects_an_unknown_join_target():
    with pytest.raises(SqlNotAllowed, match="not a table"):
        sql_guard.validate("SELECT * FROM cdr JOIN secrets ON secrets.id = cdr.CRN")


def test_rejects_a_cte_referenced_before_it_is_defined():
    """Only a CTE this statement actually defines counts as known."""
    with pytest.raises(SqlNotAllowed, match="not a table"):
        sql_guard.validate("SELECT * FROM later_cte")


# ── The row cap ────────────────────────────────────────────────────────────


def test_applies_the_limit_wrapper():
    limit = get_settings().AI_MAX_ROWS_TO_MODEL
    guarded = sql_guard.validate("SELECT * FROM cdr")
    assert guarded.startswith("SELECT * FROM (")
    assert guarded.rstrip().endswith(f"AS ai_result LIMIT {limit}")


def test_the_cap_survives_the_models_own_larger_limit():
    """The model's LIMIT ends up inside the subquery, so the outer cap holds."""
    guarded = sql_guard.validate("SELECT * FROM cdr LIMIT 100000")
    limit = get_settings().AI_MAX_ROWS_TO_MODEL
    assert guarded.index("LIMIT 100000") < guarded.index(f"LIMIT {limit}")
