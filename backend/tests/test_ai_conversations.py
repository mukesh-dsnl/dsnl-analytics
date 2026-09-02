"""
Tests for server-side chat memory.

The chat is session-based: the browser posts a `conversation_id` and the server
rebuilds the history. What that shifted onto the server is covered here —
storing an exchange as one row, capping what is replayed, and accumulating
token spend and cost.

Two tests carry more weight than the rest:

`test_only_the_last_ten_interactions_are_replayed` — the context window is the
only thing stopping the cost of a question from growing with the age of the
thread.

`test_stored_tool_calls_are_recorded_but_not_replayed` — replaying a stored
tool call is not merely wasteful, it breaks the request outright on two of the
three providers (Anthropic rejects a `tool_use` with no matching result; Gemini
rejects a function call whose per-turn `thought_signature` is missing). A future
change that starts feeding tool turns back should fail here first.
"""

import pytest

from app.ai import conversations as store
from app.core.config import get_settings
from app.models.conversation import (
    STATUS_FAIL,
    STATUS_PASS,
    STATUS_PENDING,
    Conversation,
    DeletedConversation,
    Message,
)
from app.models.user import User


def result_payload(text: str = "42 calls.", **overrides) -> dict:
    """What the orchestrator hands back, in the shape complete_interaction reads."""
    return {
        "answer": text,
        "provider": "gemini",
        "model": "gemini-3.5-flash-lite",
        "queries": [{"tool": "query_metrics", "input": {"measures": ["calls"]}, "error": False}],
        "input_tokens": 100,
        "output_tokens": 20,
        **overrides,
    }


def exchange(db, conversation, question: str, answer: str = "an answer", **overrides):
    """One complete interaction, the way the API performs it."""
    message = store.start_interaction(db, conversation, question)
    store.complete_interaction(
        db, conversation, message, result_payload(answer, **overrides), ok=True
    )
    return message


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


def test_a_known_username_is_resolved_to_its_uuid(db_session):
    user = User(username="mukesh", password_hash="x", user_id="uuid-for-mukesh")
    db_session.add(user)
    db_session.commit()

    conversation = store.get_or_create(db_session, None, "q", "mukesh")
    db_session.commit()

    assert conversation.user_id == "uuid-for-mukesh"
    assert conversation.username == "mukesh"


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


# ── One row per interaction ────────────────────────────────────────────────


def test_a_question_and_its_answer_share_one_row(db_session):
    conversation = store.get_or_create(db_session, None, "q")
    exchange(db_session, conversation, "how many calls?", "There were 42.")
    db_session.commit()

    rows = db_session.query(Message).all()
    assert len(rows) == 1
    assert rows[0].query == "how many calls?"
    assert rows[0].response == "There were 42."
    assert rows[0].status == STATUS_PASS


def test_an_interaction_starts_pending_and_is_resolved(db_session):
    """`pending` is what lets a client reloading mid-answer tell "still
    working" from "gave up" — without it the two look identical."""
    conversation = store.get_or_create(db_session, None, "q")
    message = store.start_interaction(db_session, conversation, "q")
    db_session.commit()

    assert message.status == STATUS_PENDING
    assert message.response is None

    store.complete_interaction(db_session, conversation, message, result_payload(), ok=True)
    db_session.commit()
    assert message.status == STATUS_PASS


def test_an_interaction_can_be_resolved_as_failed(db_session):
    conversation = store.get_or_create(db_session, None, "q")
    message = store.start_interaction(db_session, conversation, "the question that failed")
    store.fail_interaction(db_session, message, "The provider timed out.")
    db_session.commit()

    stored = db_session.query(Message).one()
    assert stored.status == STATUS_FAIL
    assert stored.query == "the question that failed"
    # The reason is stored as the response, so the transcript says what
    # happened rather than showing a question with silence after it.
    assert stored.response == "The provider timed out."


def test_a_pending_interaction_keeps_its_question(db_session):
    """What a reload finds when it lands mid-answer."""
    conversation = store.get_or_create(db_session, None, "q")
    store.start_interaction(db_session, conversation, "still being answered")
    db_session.commit()

    stored = db_session.query(Message).one()
    assert stored.status == STATUS_PENDING
    assert stored.query == "still being answered"
    assert stored.response is None


# ── Rebuilding the history ─────────────────────────────────────────────────


def test_history_alternates_question_and_answer_in_order(db_session):
    conversation = store.get_or_create(db_session, None, "first")
    exchange(db_session, conversation, "first", "one")
    exchange(db_session, conversation, "second", "two")
    db_session.commit()

    history = store.load_history(db_session, conversation.id)

    assert [(m.role, m.text) for m in history] == [
        ("user", "first"),
        ("assistant", "one"),
        ("user", "second"),
        ("assistant", "two"),
    ]


def test_only_the_last_ten_interactions_are_replayed(db_session):
    """The window that stops a question's cost growing with the thread."""
    conversation = store.get_or_create(db_session, None, "q1")
    for i in range(1, 16):
        exchange(db_session, conversation, f"q{i}", f"a{i}")
    db_session.commit()

    history = store.load_history(db_session, conversation.id)

    # Ten exchanges = twenty messages, and they are the *newest* ten.
    assert len(history) == store.CONTEXT_INTERACTIONS * 2
    assert history[0].text == "q6"
    assert history[-1].text == "a15"

    # The older ones are still stored — the record is complete even though the
    # replay is not.
    assert db_session.query(Message).count() == 15


def test_a_failed_interaction_replays_its_question_but_no_answer(db_session):
    """There is nothing to replay, and inventing one would put words in the
    assistant's mouth."""
    conversation = store.get_or_create(db_session, None, "q")
    message = store.start_interaction(db_session, conversation, "the one that failed")
    store.fail_interaction(db_session, message, "The provider gave out.")
    db_session.commit()

    history = store.load_history(db_session, conversation.id)
    assert [(m.role, m.text) for m in history] == [("user", "the one that failed")]


def test_history_is_empty_for_a_fresh_conversation(db_session):
    conversation = store.get_or_create(db_session, None, "q")
    db_session.commit()
    assert store.load_history(db_session, conversation.id) == []


def test_history_does_not_leak_between_conversations(db_session):
    one = store.get_or_create(db_session, None, "in thread one")
    exchange(db_session, one, "in thread one", "answer one")
    two = store.get_or_create(db_session, None, "in thread two")
    exchange(db_session, two, "in thread two", "answer two")
    db_session.commit()

    assert [m.text for m in store.load_history(db_session, one.id)] == [
        "in thread one",
        "answer one",
    ]
    assert [m.text for m in store.load_history(db_session, two.id)] == [
        "in thread two",
        "answer two",
    ]


def test_stored_tool_calls_are_recorded_but_not_replayed(db_session):
    """The split that keeps replay safe — see the module docstring."""
    conversation = store.get_or_create(db_session, None, "q")
    exchange(db_session, conversation, "q", "a")
    db_session.commit()

    # Recorded: the row keeps the calls, for the UI trace and the audit trail.
    stored = db_session.query(Message).one()
    assert stored.queries[0]["tool"] == "query_metrics"

    # Not replayed: what goes back to the model is text only.
    history = store.load_history(db_session, conversation.id)
    assert all(not m.tool_calls and not m.tool_results for m in history)


# ── Token accounting and cost ──────────────────────────────────────────────


def test_tokens_accumulate_across_interactions(db_session):
    conversation = store.get_or_create(db_session, None, "q")
    exchange(db_session, conversation, "q1", "a1", input_tokens=100, output_tokens=20)
    exchange(db_session, conversation, "q2", "a2", input_tokens=250, output_tokens=35)
    db_session.commit()

    assert conversation.input_tokens == 350
    assert conversation.output_tokens == 55
    assert conversation.total_tokens == 405


def test_each_interaction_keeps_its_own_cost(db_session):
    """So one expensive question is visible, not averaged into the thread."""
    conversation = store.get_or_create(db_session, None, "q")
    exchange(db_session, conversation, "q1", "a1", input_tokens=100, output_tokens=20)
    exchange(db_session, conversation, "q2", "a2", input_tokens=9000, output_tokens=40)
    db_session.commit()

    rows = db_session.query(Message).order_by(Message.id).all()
    assert [r.input_token for r in rows] == [100, 9000]
    assert [r.total_tokens for r in rows] == [120, 9040]


def test_missing_token_counts_are_treated_as_zero(db_session):
    """A provider that reports no usage must not poison the arithmetic."""
    conversation = store.get_or_create(db_session, None, "q")
    message = store.start_interaction(db_session, conversation, "q")
    store.complete_interaction(db_session, conversation, message, {"answer": "hi"}, ok=True)
    db_session.commit()

    assert conversation.input_tokens == 0
    assert conversation.total_tokens == 0


def test_input_and_output_are_priced_separately(db_session):
    """Averaging the two would understate exactly the long conversations."""
    settings = get_settings()
    expected = (
        1_000_000 * settings.AI_PRICE_INPUT_PER_MTOK
        + 1_000_000 * settings.AI_PRICE_OUTPUT_PER_MTOK
    ) / 1_000_000

    assert store.cost_of(1_000_000, 1_000_000) == pytest.approx(expected)
    # Output is the dearer side on every provider this supports.
    assert store.cost_of(0, 1000) > store.cost_of(1000, 0)


def test_usage_reports_tokens_and_cost(db_session):
    conversation = store.get_or_create(db_session, None, "q")
    exchange(db_session, conversation, "q", "a", input_tokens=1000, output_tokens=500)
    db_session.commit()

    reported = store.usage(conversation)
    assert reported["input_tokens"] == 1000
    assert reported["output_tokens"] == 500
    assert reported["total_tokens"] == 1500
    assert reported["cost"] == pytest.approx(store.cost_of(1000, 500))
    assert reported["currency"] == get_settings().AI_PRICE_CURRENCY


def test_zero_tokens_cost_nothing(db_session):
    conversation = store.get_or_create(db_session, None, "q")
    db_session.commit()
    assert store.usage(conversation)["cost"] == 0


# ── Renaming and deleting ──────────────────────────────────────────────────


def test_rename_replaces_the_title(db_session):
    conversation = store.get_or_create(db_session, None, "how many calls?")
    store.rename(db_session, conversation, "Monday capacity review")
    db_session.commit()

    assert conversation.title == "Monday capacity review"


def test_rename_truncates_an_overlong_title(db_session):
    conversation = store.get_or_create(db_session, None, "q")
    store.rename(db_session, conversation, "y" * 400)
    db_session.commit()

    assert len(conversation.title) == store.TITLE_LENGTH


def test_deleting_moves_the_thread_and_its_transcript(db_session):
    """A move, not a destruction — the whole thing has to survive."""
    conversation = store.get_or_create(db_session, None, "first", "mukesh")
    exchange(db_session, conversation, "first", "one", input_tokens=100, output_tokens=20)
    exchange(db_session, conversation, "second", "two", input_tokens=250, output_tokens=35)
    db_session.commit()

    original_id = conversation.id
    store.archive(db_session, conversation)
    db_session.commit()

    # Gone from the live tables…
    assert db_session.get(Conversation, original_id) is None
    assert db_session.query(Message).filter(Message.conversation_id == original_id).count() == 0

    # …and present, in full, in the archive.
    archived = db_session.get(DeletedConversation, original_id)
    assert archived is not None
    assert archived.username == "mukesh"
    assert archived.title == "first"
    assert archived.input_tokens == 350
    assert archived.output_tokens == 55
    assert archived.deleted_at is not None

    assert [m["query"] for m in archived.messages] == ["first", "second"]
    assert [m["response"] for m in archived.messages] == ["one", "two"]
    assert archived.messages[1]["input_token"] == 250


def test_the_archived_thread_keeps_its_original_id(db_session):
    """It is the same thread in a different place, not a note about one."""
    conversation = store.get_or_create(db_session, None, "q")
    original_id = conversation.id
    store.archive(db_session, conversation)
    db_session.commit()

    assert db_session.get(DeletedConversation, original_id).id == original_id


def test_deleting_an_empty_thread_still_archives_it(db_session):
    conversation = store.get_or_create(db_session, None, "never asked anything")
    db_session.commit()

    store.archive(db_session, conversation)
    db_session.commit()

    archived = db_session.get(DeletedConversation, conversation.id)
    assert archived is not None
    assert archived.messages == []


def test_deleting_one_thread_leaves_the_others_alone(db_session):
    keep = store.get_or_create(db_session, None, "keep me")
    exchange(db_session, keep, "keep me", "still here")
    drop = store.get_or_create(db_session, None, "drop me")
    exchange(db_session, drop, "drop me", "gone")
    db_session.commit()

    store.archive(db_session, drop)
    db_session.commit()

    assert db_session.get(Conversation, keep.id) is not None
    assert db_session.query(Message).filter(Message.conversation_id == keep.id).count() == 1


# ── The orchestrator's side of the contract ────────────────────────────────


def test_the_orchestrator_reports_tokens_it_can_store(monkeypatch):
    """`answer()` must return the keys complete_interaction reads, summed."""
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
