"""
Orchestrator tests against a scripted fake client. No network, no API key.

The loop's job is narrow — decide whether to run tools or stop, group results
correctly, and never run forever — so the model is replaced by a fake that
returns a fixed sequence of turns. That makes the three behaviours that
actually matter directly assertable.

The second half exercises the ad-hoc SQL tool against real fixture parquet,
including the filesystem lockdown. That is the layer the design's safety
actually rests on, so it is proved here rather than assumed: DuckDB is local,
so this still involves no network.
"""

from datetime import timedelta

import pytest

from app.ai import orchestrator
from app.ai.providers.base import LLMClient, LLMTurn, NeutralMessage, ToolCallRequest
from app.core.config import get_settings
from tests.conftest import VOICEDROP_4021_TOTAL


class FakeLLMClient(LLMClient):
    """Returns a scripted sequence of turns and records what it was sent."""

    provider = "fake"
    model = "fake-1"

    def __init__(self, turns: list[LLMTurn], repeat_last: bool = False):
        self._turns = list(turns)
        self._repeat_last = repeat_last
        self.calls: list[list[NeutralMessage]] = []

    def send(self, system, history, tools):
        # A copy: the orchestrator mutates its own list as it goes, and the
        # assertions below are about what each round actually saw.
        self.calls.append(list(history))
        if self._turns:
            return self._turns.pop(0) if len(self._turns) > 1 or not self._repeat_last else self._turns[0]
        raise AssertionError("FakeLLMClient ran out of scripted turns")


@pytest.fixture
def spy_dispatch(monkeypatch):
    """Replace both tools with recorders, so no query touches the lake."""
    seen: list[tuple[str, dict]] = []

    def make(name, content="{}", is_error=False):
        def handler(**kwargs):
            seen.append((name, kwargs))
            return (content, is_error)

        return handler

    monkeypatch.setitem(orchestrator.DISPATCH, "get_cdr_panel", make("get_cdr_panel"))
    monkeypatch.setitem(orchestrator.DISPATCH, "run_cdr_query", make("run_cdr_query"))
    return seen


# ── The three loop behaviours ──────────────────────────────────────────────


def test_runs_a_tool_then_returns_the_final_answer(spy_dispatch):
    client = FakeLLMClient(
        [
            LLMTurn(
                text="Let me check.",
                tool_calls=[
                    ToolCallRequest(
                        id="c1",
                        name="get_cdr_panel",
                        input={"panel": "summary", "date_from": "2026-08-01", "date_to": "2026-08-01"},
                    )
                ],
                stop_reason="tool_use",
            ),
            LLMTurn(text="There were 42 calls on 2026-08-01.", stop_reason="end_turn"),
        ]
    )

    result = orchestrator.answer(question="how many calls?", llm=client)

    assert [name for name, _ in spy_dispatch] == ["get_cdr_panel"]
    assert spy_dispatch[0][1]["panel"] == "summary"
    assert result["answer"] == "There were 42 calls on 2026-08-01."
    assert result["provider"] == "fake"
    assert result["model"] == "fake-1"
    assert result["queries"] == [
        {
            "tool": "get_cdr_panel",
            "input": {"panel": "summary", "date_from": "2026-08-01", "date_to": "2026-08-01"},
            "error": False,
        }
    ]


def test_stops_at_the_round_budget_instead_of_looping_forever(spy_dispatch):
    """A model that always asks for a tool must not run indefinitely."""
    always_tool = LLMTurn(
        text="",
        tool_calls=[ToolCallRequest(id="c", name="get_cdr_panel", input={"panel": "summary"})],
        stop_reason="tool_use",
    )
    client = FakeLLMClient([always_tool], repeat_last=True)

    result = orchestrator.answer(question="loop forever", llm=client)

    max_rounds = get_settings().AI_MAX_TOOL_ROUNDS
    assert result["answer"] == orchestrator.BUDGET_EXCEEDED
    assert len(spy_dispatch) == max_rounds
    assert len(client.calls) == max_rounds


def test_an_out_of_scope_question_never_reaches_a_tool(spy_dispatch):
    """A refusal is an end_turn on round one — dispatch must not be touched."""
    client = FakeLLMClient(
        [
            LLMTurn(
                text="I don't have billing data — only call legs, durations and outcomes.",
                stop_reason="end_turn",
            )
        ]
    )

    result = orchestrator.answer(question="what is account 4021 billed?", llm=client)

    assert spy_dispatch == []
    assert result["queries"] == []
    assert "billing" in result["answer"]


# ── History construction ───────────────────────────────────────────────────


def test_all_results_from_one_turn_go_in_a_single_message(spy_dispatch):
    """Anthropic requires grouped tool results; splitting degrades silently."""
    client = FakeLLMClient(
        [
            LLMTurn(
                text="",
                tool_calls=[
                    ToolCallRequest(id="a", name="get_cdr_panel", input={"panel": "summary"}),
                    ToolCallRequest(id="b", name="run_cdr_query", input={"sql": "SELECT 1"}),
                ],
                stop_reason="tool_use",
            ),
            LLMTurn(text="Done.", stop_reason="end_turn"),
        ]
    )

    orchestrator.answer(question="two at once", llm=client)

    # What the second round was sent: [user question, assistant calls, results]
    second_round = client.calls[1]
    result_messages = [m for m in second_round if m.tool_results]
    assert len(result_messages) == 1
    assert [r.call_id for r in result_messages[0].tool_results] == ["a", "b"]


def test_prior_history_is_carried_into_the_conversation(spy_dispatch):
    client = FakeLLMClient([LLMTurn(text="ok", stop_reason="end_turn")])
    prior = [NeutralMessage(role="user", text="earlier question")]

    orchestrator.answer(history=prior, question="follow-up", llm=client)

    sent = client.calls[0]
    assert [m.text for m in sent] == ["earlier question", "follow-up"]


def test_an_unknown_tool_name_is_reported_to_the_model_not_raised(spy_dispatch):
    """A hallucinated tool is recoverable — the model gets told and tries again."""
    client = FakeLLMClient(
        [
            LLMTurn(
                text="",
                tool_calls=[ToolCallRequest(id="x", name="get_billing", input={})],
                stop_reason="tool_use",
            ),
            LLMTurn(text="Sorry, no billing data.", stop_reason="end_turn"),
        ]
    )

    result = orchestrator.answer(question="billing?", llm=client)

    assert result["queries"][0]["error"] is True
    results = [m for m in client.calls[1] if m.tool_results][0].tool_results
    assert "no tool called 'get_billing'" in results[0].content


def test_a_raising_tool_becomes_an_error_result(monkeypatch):
    def explode(**kwargs):
        raise RuntimeError("disk on fire")

    monkeypatch.setitem(orchestrator.DISPATCH, "get_cdr_panel", explode)
    client = FakeLLMClient(
        [
            LLMTurn(
                text="",
                tool_calls=[ToolCallRequest(id="x", name="get_cdr_panel", input={})],
                stop_reason="tool_use",
            ),
            LLMTurn(text="That failed.", stop_reason="end_turn"),
        ]
    )

    result = orchestrator.answer(question="q", llm=client)

    assert result["answer"] == "That failed."
    assert result["queries"][0]["error"] is True


# ── The ad-hoc SQL tool, against real fixture parquet ──────────────────────


def test_ad_hoc_query_returns_rows_from_the_lake(fixture_lake):
    from app.ai.tools.ad_hoc_sql import run_cdr_query

    content, is_error = run_cdr_query(
        date_from=fixture_lake.isoformat(),
        date_to=fixture_lake.isoformat(),
        sql="SELECT COUNT(*) AS n FROM cdr WHERE INCONF_DATETIME_EPOC <> 0",
        purpose="connected legs",
    )

    assert is_error is False
    # Four of the six fixture legs connected — see tests/conftest.py.
    assert '"n": 4' in content


def test_ad_hoc_query_can_join_both_tables(fixture_lake):
    from app.ai.tools.ad_hoc_sql import run_cdr_query

    content, is_error = run_cdr_query(
        date_from=fixture_lake.isoformat(),
        date_to=fixture_lake.isoformat(),
        sql=(
            "SELECT COUNT(*) AS n FROM cdr c "
            "JOIN codr o ON o.CRN = c.CRN AND o.CONF_NUM = c.CONF_NUM "
            "WHERE c.CONFEREE_TYPE = 6 AND o.MODULE_TYPE = 3"
        ),
        purpose="voicedrop legs",
    )

    assert is_error is False
    assert f'"n": {VOICEDROP_4021_TOTAL}' in content


def test_the_filesystem_is_disabled_before_generated_sql_runs(fixture_lake, monkeypatch):
    """The real backstop: even SQL that bypassed the guard cannot read a file.

    The text guard is monkeypatched out entirely so that only DuckDB's own
    lockdown is under test. If this passes, a gap in the denylist is not a
    file-disclosure bug.
    """
    from app.ai.tools import ad_hoc_sql

    monkeypatch.setattr(ad_hoc_sql.sql_guard, "validate", lambda sql: sql)

    content, is_error = ad_hoc_sql.run_cdr_query(
        date_from=fixture_lake.isoformat(),
        date_to=fixture_lake.isoformat(),
        sql="SELECT * FROM read_csv('C:/Windows/win.ini')",
        purpose="attempt to read a file",
    )

    assert is_error is True
    assert "disabled" in content.lower() or "permission" in content.lower()


def test_rejects_a_range_wider_than_the_ai_limit(fixture_lake):
    from app.ai.tools.ad_hoc_sql import run_cdr_query

    limit = get_settings().AI_MAX_RANGE_DAYS
    start = fixture_lake
    content, is_error = run_cdr_query(
        date_from=start.isoformat(),
        date_to=(start + timedelta(days=limit)).isoformat(),
        sql="SELECT 1 FROM cdr",
        purpose="too wide",
    )

    assert is_error is True
    assert str(limit) in content


def test_reports_a_range_the_lake_cannot_cover(fixture_lake):
    """An empty answer must never be confused with a quiet day."""
    from app.ai.tools.ad_hoc_sql import run_cdr_query

    missing = fixture_lake - timedelta(days=5)
    content, is_error = run_cdr_query(
        date_from=missing.isoformat(),
        date_to=missing.isoformat(),
        sql="SELECT COUNT(*) FROM cdr",
        purpose="range with no export",
    )

    assert is_error is True
    assert "No CDR export files" in content


def test_zero_rows_is_not_an_error(fixture_lake):
    from app.ai.tools.ad_hoc_sql import run_cdr_query

    content, is_error = run_cdr_query(
        date_from=fixture_lake.isoformat(),
        date_to=fixture_lake.isoformat(),
        sql="SELECT * FROM cdr WHERE ACCOUNTID = 999999",
        purpose="no matches",
    )

    assert is_error is False
    assert "0 rows" in content


def test_a_rejected_statement_never_executes(fixture_lake):
    from app.ai.tools.ad_hoc_sql import run_cdr_query

    content, is_error = run_cdr_query(
        date_from=fixture_lake.isoformat(),
        date_to=fixture_lake.isoformat(),
        sql="DROP TABLE cdr",
        purpose="should be refused",
    )

    assert is_error is True
    assert "read-only" in content or "SELECT" in content


# ── The structured tool ────────────────────────────────────────────────────


def test_structured_tool_runs_a_panel(fixture_lake):
    from app.ai.tools.structured import get_cdr_panel

    content, is_error = get_cdr_panel(
        panel="summary",
        date_from=fixture_lake.isoformat(),
        date_to=fixture_lake.isoformat(),
    )

    assert is_error is False
    assert "total_calls" in content


def test_structured_tool_accepts_the_service_argument_by_its_schema_name(fixture_lake):
    """The schema calls it `service`; the parameter can't, without shadowing the module."""
    from app.ai.tools.structured import get_cdr_panel

    content, is_error = get_cdr_panel(
        panel="summary",
        date_from=fixture_lake.isoformat(),
        date_to=fixture_lake.isoformat(),
        service="voicedrop",
    )

    assert is_error is False
    assert '"service": "voicedrop"' in content


def test_structured_tool_rejects_an_unknown_panel(fixture_lake):
    from app.ai.tools.structured import get_cdr_panel

    content, is_error = get_cdr_panel(
        panel="revenue", date_from=fixture_lake.isoformat(), date_to=fixture_lake.isoformat()
    )

    assert is_error is True
    assert "summary" in content  # the message lists the real choices


def test_structured_tool_returns_validation_errors_for_the_model_to_fix():
    from app.ai.tools.structured import get_cdr_panel

    content, is_error = get_cdr_panel(
        panel="summary", date_from="2026-08-10", date_to="2026-08-01"
    )

    assert is_error is True
    assert "date_to" in content
