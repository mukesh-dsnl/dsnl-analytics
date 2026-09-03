"""
Tests for stopping an answer in progress.

The distinction these exist to protect:

    the browser disconnects   →  the work continues and is saved
    the user presses Stop     →  the work is abandoned

Those are the same event at the socket, so the second cannot be inferred from
the first — a disconnect is exactly the case the background worker exists to
survive. `test_disconnecting_does_not_stop_the_work` is the guard on that half:
without it, someone could "fix" stopping by cancelling on disconnect and
silently undo refresh-survival.

The claim worth testing is that a stop actually *stops* — not that a button
changes shape. `test_stopping_halts_the_rounds` counts rounds the orchestrator
was allowed to run, which is what a provider bills for.
"""

import threading
import time

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base
from app.ai import conversations as store
from app.ai import jobs
from app.core.database import Base
from app.models.conversation import (
    STATUS_PASS,
    STATUS_PENDING,
    STATUS_STOPPED,
    Conversation,
    Message,
)
from app.models.user import User


@pytest.fixture
def engine():
    """One shared in-memory database. StaticPool because the worker runs on its
    own thread and must see the same rows the test wrote."""
    engine = create_engine(
        "sqlite://",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def db(engine, monkeypatch):
    """A session, with the worker's own SessionLocal pointed at the same engine."""
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    monkeypatch.setattr(jobs, "SessionLocal", factory)
    session = factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def interaction(db):
    """A conversation with one pending interaction, as the endpoint leaves it."""
    user = User(username="alice", password_hash="x", user_id="uuid-alice")
    db.add(user)
    db.commit()
    conversation = store.get_or_create(db, None, "a long question", user)
    message = store.start_interaction(db, conversation, "a long question")
    db.commit()
    return conversation, message


class SlowRounds:
    """An orchestrator that reports rounds forever, pausing between them.

    Stands in for a real loop so the test can stop it mid-flight without a
    provider. `rounds_run` is the number it was actually allowed to reach —
    what a provider would have charged for.
    """

    def __init__(self, pause=0.05, total=40):
        self.rounds_run = 0
        self.pause = pause
        self.total = total
        self.exhausted = threading.Event()

    def __call__(self, history, question, llm):
        for index in range(1, self.total + 1):
            self.rounds_run = index
            yield {"type": "round_start", "round": index}
            yield {
                "type": "round_thinking",
                "round": index,
                "seconds": 0.0,
                "input_tokens": 100,
                "output_tokens": 10,
            }
            time.sleep(self.pause)
        self.exhausted.set()
        yield {"type": "done", "answer": "finished", "queries": [],
               "input_tokens": 0, "output_tokens": 0}


def drain(events, stop_after=None):
    """Consume the event iterator, optionally calling a hook part-way."""
    seen = []
    for event in events:
        seen.append(event)
        if stop_after is not None and len(seen) == stop_after[0]:
            stop_after[1]()
    return seen


# ── Stopping really stops ──────────────────────────────────────────────────


def test_stopping_halts_the_rounds(db, interaction, monkeypatch):
    """The point of the whole feature: rounds stop being run.

    Abandoning the orchestrator's generator suspends it, so no further round —
    and therefore no further provider call — is started.
    """
    conversation, message = interaction
    slow = SlowRounds()
    monkeypatch.setattr("app.ai.orchestrator.answer_events", slow)

    events = jobs.run(
        conversation_id=conversation.id,
        interaction_id=message.id,
        history=[],
        question="a long question",
        llm=object(),
    )

    # Let a few rounds happen, then stop it the way the endpoint does.
    seen = drain(events, stop_after=(4, lambda: jobs.request_stop(message.id)))

    assert not slow.exhausted.is_set(), "the loop ran to completion despite the stop"
    assert slow.rounds_run < slow.total
    assert any(event["type"] == "stopped" for event in seen)


def test_stopping_records_the_status_and_the_spend(db, interaction, monkeypatch):
    """A stop is not a failure, and it is not free.

    The tokens already spent are banked — the point of stopping is usually to
    stop spending, so a cost that omitted what was spent up to that moment
    would understate exactly the case being watched.
    """
    conversation, message = interaction
    monkeypatch.setattr("app.ai.orchestrator.answer_events", SlowRounds())

    events = jobs.run(
        conversation_id=conversation.id,
        interaction_id=message.id,
        history=[],
        question="a long question",
        llm=object(),
    )
    drain(events, stop_after=(4, lambda: jobs.request_stop(message.id)))

    db.expire_all()
    stored = db.get(Message, message.id)
    assert stored.status == STATUS_STOPPED
    assert stored.status != "fail", "a deliberate stop must not be recorded as a failure"
    assert stored.input_token > 0, "tokens already spent were not recorded"
    assert db.get(Conversation, conversation.id).input_tokens > 0


def test_the_stored_status_fits_its_column():
    """String(8). "cancelled" would not fit; "stopped" does.

    Silently truncated on a permissive MySQL and rejected on a strict one, so
    this is worth asserting rather than remembering.
    """
    width = Message.__table__.columns["status"].type.length
    assert len(STATUS_STOPPED) <= width
    for status in (STATUS_PENDING, STATUS_PASS, STATUS_STOPPED):
        assert len(status) <= width


def test_stopping_twice_is_harmless(db, interaction):
    """A client that pressed the button twice has not done anything wrong."""
    _, message = interaction
    assert jobs.request_stop(message.id) is False  # nothing running
    assert jobs.request_stop(message.id) is False


def test_a_finished_answer_is_not_overwritten_by_a_late_stop(db, interaction, monkeypatch):
    """The cross-process case, in reverse: the row already says `stopped`, and
    the worker must not write an answer over it."""
    conversation, message = interaction

    def one_round(history, question, llm):
        yield {"type": "round_start", "round": 1}
        # Somebody stops it — in another process, where the in-memory Event
        # signals nothing — while this round is still running.
        other = sessionmaker(bind=db.get_bind())()
        store.stop_interaction(
            other, other.get(Conversation, conversation.id), other.get(Message, message.id)
        )
        other.commit()
        other.close()
        yield {"type": "done", "answer": "an answer nobody waited for", "queries": [],
               "input_tokens": 5, "output_tokens": 5}

    monkeypatch.setattr("app.ai.orchestrator.answer_events", one_round)

    list(
        jobs.run(
            conversation_id=conversation.id,
            interaction_id=message.id,
            history=[],
            question="q",
            llm=object(),
        )
    )

    db.expire_all()
    stored = db.get(Message, message.id)
    assert stored.status == STATUS_STOPPED
    assert "nobody waited for" not in (stored.response or "")


# ── …and a disconnect still does not ───────────────────────────────────────


def test_disconnecting_does_not_stop_the_work(db, interaction, monkeypatch):
    """The other half of the contract, and the one easiest to break.

    Closing the browser must let the answer finish and commit — that is what
    makes a refresh survivable. If this ever fails because someone wired
    cancellation to disconnection, the fix is not to delete this test.
    """
    conversation, message = interaction
    slow = SlowRounds(pause=0.01, total=3)
    monkeypatch.setattr("app.ai.orchestrator.answer_events", slow)

    events = jobs.run(
        conversation_id=conversation.id,
        interaction_id=message.id,
        history=[],
        question="q",
        llm=object(),
    )
    next(events)          # start watching
    events.close()        # the client goes away, without asking to stop

    deadline = time.time() + 5
    while time.time() < deadline:
        db.expire_all()
        if db.get(Message, message.id).status != STATUS_PENDING:
            break
        time.sleep(0.05)

    stored = db.get(Message, message.id)
    assert stored.status == STATUS_PASS, "a disconnect cancelled the work"
    assert stored.response == "finished"
