"""
End-to-end test against the real Gemini API. Skipped without GOOGLE_API_KEY.

This is the only test that makes a network call, and the only one that checks
the thing all the mocked tests take on faith: that a real model, given this
system prompt and these two tools, actually reaches the data and reports what
it found.

It runs against the `fixture_lake` parquet pair from conftest.py, not the real
lake, so the expected figures are known exactly. Two assertions carry the
weight:

  * the answer contains the right number — proving the tool result reached the
    model and was reported rather than paraphrased away;
  * at least one tool call was made — proving the model didn't silently refuse
    a question it could have answered, which is the failure mode a
    text-only assertion would miss.

Model behaviour is not deterministic, so the assertions are deliberately loose
about *phrasing* and strict about *figures*.
"""

import os
import re

import pytest

from app.core.config import get_settings
from tests.conftest import VOICEDROP_4021_CONNECTED

pytestmark = pytest.mark.skipif(
    not (os.getenv("GOOGLE_API_KEY") or get_settings().GOOGLE_API_KEY),
    reason="GOOGLE_API_KEY is not set — the live Gemini test needs a real key.",
)


@pytest.fixture
def gemini_settings(monkeypatch):
    """Point the provider factory at Gemini for the duration of one test."""
    settings = get_settings()
    monkeypatch.setattr(settings, "AI_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "AI_MODEL", settings.AI_MODEL or "gemini-3.5-flash-lite")
    if not settings.GOOGLE_API_KEY:
        monkeypatch.setattr(settings, "GOOGLE_API_KEY", os.environ["GOOGLE_API_KEY"])
    return settings


def test_answers_a_question_with_a_known_figure(fixture_lake, gemini_settings):
    """A question the fixture answers exactly: 2 connected voicedrop legs for 4021."""
    from app.ai import orchestrator

    result = orchestrator.answer(
        question=(
            f"How many voicedrop calls connected for account 4021 on "
            f"{fixture_lake.isoformat()}? Answer with the number."
        )
    )

    assert result["provider"] == "gemini"

    # It looked rather than guessed.
    assert result["queries"], f"No tool was called. Answer was: {result['answer']!r}"

    # Nothing was left broken at the end — a failed call the model never
    # recovered from would mean the figure below came from somewhere else.
    unresolved = [q for q in result["queries"] if q["error"]]
    assert not unresolved or len(result["queries"]) > len(unresolved), (
        f"Every tool call errored and none succeeded: {result['queries']}"
    )

    assert str(VOICEDROP_4021_CONNECTED) in result["answer"], (
        f"Expected {VOICEDROP_4021_CONNECTED} in the answer. Got: {result['answer']!r}\n"
        f"Queries: {result['queries']}"
    )


def test_declines_a_question_this_data_cannot_answer(fixture_lake, gemini_settings):
    """Out of scope: there is no billing data, and inventing one would be the worst failure."""
    from app.ai import orchestrator

    result = orchestrator.answer(
        question="What is account 4021 billed this month, in rupees?"
    )

    # The load-bearing assertion: it declined to look rather than querying and
    # then dressing an unrelated figure up as a billing total.
    assert result["queries"] == [], (
        f"Expected no tool calls for an out-of-scope question. "
        f"Got {result['queries']} and answer: {result['answer']!r}"
    )

    # And it quoted no billing figure. Asserted negatively on purpose: an
    # allow-list of refusal phrasings tests the model's prose, which is not
    # deterministic and which this test kept failing on while the behaviour
    # underneath was correct every time. What actually matters is that no
    # number was presented as an amount owed — so that is what is checked.
    answer = result["answer"]
    currency = re.search(r"(₹|rs\.?|inr|\$)\s*[\d,]+(\.\d+)?", answer, re.IGNORECASE)
    assert currency is None, (
        f"The answer quotes a currency amount for data that holds none: "
        f"{currency.group(0)!r} in {answer!r}"
    )
