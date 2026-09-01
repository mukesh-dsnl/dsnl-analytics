"""
Tests for server-side chat memory.

The chat moved from stateless (browser posts the whole transcript) to
session-based (browser posts an id). What that shifted onto the server is
covered here: rebuilding history, appending turns in order, and accumulating
token spend.

The sharpest test in this file is
`test_stored_tool_calls_are_recorded_but_not_replayed`. Replaying a stored tool
call is not merely wasteful — it breaks the request outright on two of the
three providers (Anthropic rejects a `tool_use` with no matching result;
Gemini rejects a function call whose per-turn `thought_signature` is missing).
So the split between what is recorded and what is replayed is load-bearing, and
a future change that starts feeding tool turns back should fail here first.
"""

import pytest

from app.ai import conversations as store
from app.models.conversation import Conversation, Message


def answer_payload(text: str = "42 calls.", **overrides) -> dict:
    """What the orchestrator hands back, in the shape save_answer expects."""
    return {
        "answer": text,
        "provider": "gemini",
        "model": "gemini-3.5-flash-lite",
        "queries": [{"tool": "query_metrics", "input": {"measures": ["calls"]}, "error": False}],
        "input_tokens": 100,
        "output_tokens": 20,
        **overrides,
    }


# ── Starting and resuming ──────────────────────────────────────────────────


def test_a_question_with_no_id_starts_a_conversation(db_session):
    conversation = store.get_or_create(db_session, None, "how many calls?", "mukesh")
    db_session.commit()

    assert conversation.id
    assert conversation.title == "how many calls?"
    assert conversation.username == "mukesh"
    assert conversation.input_tokens == 0


def test_an_existing_id_resumes_rather_than_starting_over(db_session):
    first = store.get_or_create(db_session, None, "first question")
    db_session.commit()

    again = store.get_or_create(db_session, first.id, "second question")
    db_session.commit()

    assert again.id == first.id
    # The title is the opening question and does not drift to the latest one.
    assert again.title == "first question"
    assert db_session.query(Conversation).count() == 1


def test_an_unknown_id_is_adopted_rather_than_rejected(db_session):
    """The client already believes it owns that thread; handing back a
    different id would silently split the transcript in two."""
    conversation = store.get_or_create(db_session, "not-in-the-database", "q")
    db_session.commit()

    assert conversation.id == "not-in-the-database"


def test_an_unknown_username_is_still_recorded(db_session):
    """It labels a conversation; it is not a permission check."""
    conversation = store.get_or_create(db_session, None, "q", "nobody-by-that-name")
    db_session.commit()

    assert conversation.username == "nobody-by-that-name"
    assert conversation.user_id is None


def test_a_long_question_is_truncated_into_the_title(db_session):
    conversation = store.get_or_create(db_session, None, "x" * 500)
    db_session.commit()
    assert len(conversation.title) == store.TITLE_LENGTH


# ── Rebuilding the history ─────────────────────────────────────────────────


def test_history_comes_back_in_order(db_session):
    conversation = store.get_or_create(db_session, None, "first")
    store.save_question(db_session, conversation, "first")
    store.save_answer(db_session, conversation, answer_payload("one"))
    store.save_question(db_session, conversation, "second")
    store.save_answer(db_session, conversation, answer_payload("two"))
    db_session.commit()

    history = store.load_history(db_session, conversation.id)

    assert [(m.role, m.text) for m in history] == [
        ("user", "first"),
        ("assistant", "one"),
        ("user", "second"),
        ("assistant", "two"),
    ]


def test_history_is_empty_for_a_fresh_conversation(db_session):
    conversation = store.get_or_create(db_session, None, "q")
    db_session.commit()
    assert store.load_history(db_session, conversation.id) == []


def test_history_does_not_leak_between_conversations(db_session):
    one = store.get_or_create(db_session, None, "in thread one")
    store.save_question(db_session, one, "in thread one")
    two = store.get_or_create(db_session, None, "in thread two")
    store.save_question(db_session, two, "in thread two")
    db_session.commit()

    assert [m.text for m in store.load_history(db_session, one.id)] == ["in thread one"]
    assert [m.text for m in store.load_history(db_session, two.id)] == ["in thread two"]


def test_stored_tool_calls_are_recorded_but_not_replayed(db_session):
    """The split that keeps replay safe — see the module docstring."""
    conversation = store.get_or_create(db_session, None, "q")
    store.save_question(db_session, conversation, "q")
    store.save_answer(db_session, conversation, answer_payload())
    db_session.commit()

    # Recorded: the row keeps the calls, for the UI and the audit trail.
    stored = (
        db_session.query(Message)
        .filter(Message.role == "assistant")
        .one()
    )
    assert stored.content["queries"][0]["tool"] == "query_metrics"

    # Not replayed: what goes back to the model is text only.
    history = store.load_history(db_session, conversation.id)
    assert all(not m.tool_calls and not m.tool_results for m in history)


def test_a_turn_with_no_text_is_skipped(db_session):
    """A message carrying no prose has nothing the model can read."""
    conversation = store.get_or_create(db_session, None, "q")
    db_session.add(
        Message(conversation_id=conversation.id, role="assistant", content={"queries": []})
    )
    db_session.commit()

    assert store.load_history(db_session, conversation.id) == []


# ── Token accounting ───────────────────────────────────────────────────────


def test_tokens_accumulate_across_turns(db_session):
    conversation = store.get_or_create(db_session, None, "q")
    store.save_answer(db_session, conversation, answer_payload(input_tokens=100, output_tokens=20))
    store.save_answer(db_session, conversation, answer_payload(input_tokens=250, output_tokens=35))
    db_session.commit()

    assert conversation.input_tokens == 350
    assert conversation.output_tokens == 55
    assert conversation.total_tokens == 405
    assert store.usage(conversation) == {
        "input_tokens": 350,
        "output_tokens": 55,
        "total_tokens": 405,
    }


def test_each_message_keeps_its_own_cost(db_session):
    """So one expensive question is visible, not averaged into the thread."""
    conversation = store.get_or_create(db_session, None, "q")
    store.save_answer(db_session, conversation, answer_payload(input_tokens=100, output_tokens=20))
    store.save_answer(db_session, conversation, answer_payload(input_tokens=9000, output_tokens=40))
    db_session.commit()

    rows = db_session.query(Message).order_by(Message.id).all()
    assert [r.input_tokens for r in rows] == [100, 9000]


def test_missing_token_counts_are_treated_as_zero(db_session):
    """A provider that reports no usage must not poison the arithmetic."""
    conversation = store.get_or_create(db_session, None, "q")
    store.save_answer(
        db_session, conversation, {"answer": "hi", "queries": []}
    )
    db_session.commit()

    assert conversation.input_tokens == 0
    assert conversation.total_tokens == 0


# ── The orchestrator's side of the contract ────────────────────────────────


def test_the_orchestrator_reports_tokens_it_can_store(monkeypatch):
    """`answer()` must return the keys save_answer reads, summed over rounds."""
    from app.ai import orchestrator
    from app.ai.providers.base import LLMTurn, ToolCallRequest
    from tests.test_ai_orchestrator import FakeLLMClient

    monkeypatch.setitem(orchestrator.DISPATCH, "query_metrics", lambda **kw: ("{}", False))

    client = FakeLLMClient(
        [
            LLMTurn(
                text="",
                tool_calls=[ToolCallRequest(id="c1", name="query_metrics", input={})],
                stop_reason="tool_use",
                input_tokens=1000,
                output_tokens=30,
            ),
            LLMTurn(text="Done.", stop_reason="end_turn", input_tokens=1200, output_tokens=50),
        ]
    )

    result = orchestrator.answer(question="q", llm=client)

    # Both rounds counted — a multi-round answer resends the system prompt.
    assert result["input_tokens"] == 2200
    assert result["output_tokens"] == 80
