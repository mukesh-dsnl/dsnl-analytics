"""The model has no clock: every answer must be told today's date, and that a
date written without a year means the current year."""

from datetime import date

from app.ai import orchestrator, schema_prompt
from app.ai.providers.base import LLMClient, LLMTurn, ToolCallRequest
from app.ai.schema_prompt import SYSTEM_PROMPT, dated_system_prompt


def test_the_prompt_states_today_and_resolves_relative_dates():
    prompt = dated_system_prompt(date(2026, 10, 6))
    assert "Today is Tuesday, 06 October 2026 (2026-10-06)" in prompt
    assert '"yesterday" is 2026-10-05' in prompt
    assert '"this month"\n    is 2026-10-01 to 2026-10-06' in prompt
    assert "September 2026 (2026-09-01 to 2026-09-30)" in prompt


def test_a_date_without_a_year_means_the_current_year():
    prompt = dated_system_prompt(date(2026, 10, 6))
    assert "is in the current year, 2026" in prompt
    assert "do not ask which year is meant" in prompt


def test_month_and_year_boundaries():
    prompt = dated_system_prompt(date(2027, 1, 1))
    assert '"yesterday" is 2026-12-31' in prompt
    assert "December 2026 (2026-12-01 to 2026-12-31)" in prompt
    assert "is in the current year, 2027" in prompt


def test_the_fixed_part_stays_an_identical_prefix():
    # Only the tail changes day to day, so provider-side prompt caching of the
    # long schema part keeps working.
    assert dated_system_prompt(date(2026, 10, 6)).startswith(SYSTEM_PROMPT)
    assert dated_system_prompt(date(2026, 10, 7)).startswith(SYSTEM_PROMPT)


def test_today_follows_the_configured_timezone(monkeypatch):
    settings = schema_prompt.get_settings()
    monkeypatch.setattr(settings, "TIMEZONE", "Not/AZone")
    assert schema_prompt.today_local() == date.today()  # falls back, never raises


class SystemSpy(LLMClient):
    """Asks for one tool round, then answers; records the system prompt sent."""

    provider, model = "fake", "fake-1"

    def __init__(self):
        self.systems: list[str] = []

    def send(self, system, history, tools):
        self.systems.append(system)
        if len(self.systems) == 1:
            call = ToolCallRequest(id="c1", name=next(iter(orchestrator.DISPATCH)), input={})
            return LLMTurn(text="", tool_calls=[call], stop_reason="tool_use")
        return LLMTurn(text="done")


def test_every_round_of_an_answer_sends_the_same_dated_prompt(monkeypatch):
    monkeypatch.setattr(orchestrator, "dated_system_prompt", lambda: "PROMPT dated 2026-10-06")
    for name in list(orchestrator.DISPATCH):
        monkeypatch.setitem(orchestrator.DISPATCH, name, lambda **_: ("{}", False))

    spy = SystemSpy()
    list(orchestrator.answer_events(question="minutes yesterday?", llm=spy))

    assert spy.systems == ["PROMPT dated 2026-10-06"] * 2
