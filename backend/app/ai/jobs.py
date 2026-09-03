"""
Running an answer independently of the request that asked for it.

The streaming endpoint used to *be* the work: the orchestrator loop lived
inside the response generator, pulled forward one event at a time as Starlette
wrote to the socket. That made a browser refresh destructive — the connection
went away, the generator was cancelled wherever it stood, and since the answer
is only written when the loop reaches its `done` event, nothing was saved. The
question survived as a row with no reply and the work was simply lost.

Here the loop runs on its own thread with its own database session, and the
response generator merely *watches* it through a queue. Close the browser and
the thread carries on, finishes the answer, and commits it. The next page load
finds it waiting.

A thread rather than a task because everything below it is blocking — the
provider SDKs and DuckDB both are — so this would occupy the event loop
regardless; a thread at least says so honestly.

Deliberately no cross-request registry for *reading*. A reconnecting client does
not re-attach to a running job, it polls for the result (the interaction is
`pending` until it lands). Re-attaching would need buffering, replay, and — with
more than one worker process — a shared broker, which is a great deal of
machinery for the ability to watch a progress line you have already seen.

Stopping is the one thing that does need to reach a running job, and it is
carefully distinguished from a client merely going away:

    the browser disconnects   →  the work continues and is saved
    the user presses Stop     →  the work is abandoned

Those look identical from the socket, which is why a disconnect cannot be
treated as a cancellation — it is exactly the case the design above exists to
survive. So a stop is an explicit request (`POST .../stop`), never an inference.

It is honoured in two independent ways, because they fail in different places:

  * an in-process `threading.Event`, checked between the orchestrator's own
    events — instant, and what actually halts the loop;
  * the interaction's stored status, which the worker re-reads before it writes
    an answer. With more than one uvicorn worker the stop request may land in a
    process that is not running the job, and the Event there signals nothing.
    The status check is what stops a job in that situation from overwriting the
    record with an answer nobody is waiting for.
"""

import logging
import queue
import threading
from typing import Any, Iterator

from sqlalchemy.orm import Session

from app.ai import conversations as store
from app.ai import orchestrator
from app.ai.providers.base import LLMClient, NeutralMessage
from app.core.database import SessionLocal
from app.models.conversation import STATUS_PENDING, Conversation, Message

logger = logging.getLogger(__name__)

# Put on the queue when the worker is finished, so the reader stops waiting.
_SENTINEL = object()

# How long a reader waits on an empty queue before checking whether the worker
# is still alive. Only bounds how quickly a dead worker is noticed.
_POLL_SECONDS = 0.5

# ── Stop signalling ────────────────────────────────────────────────────────
# One Event per running answer, keyed by interaction id. Guarded by a lock
# because the setter is a request thread and the reader is the worker.

_stops: dict[int, threading.Event] = {}
_stops_lock = threading.Lock()


def _register(interaction_id: int) -> threading.Event:
    event = threading.Event()
    with _stops_lock:
        _stops[interaction_id] = event
    return event


def _unregister(interaction_id: int) -> None:
    with _stops_lock:
        _stops.pop(interaction_id, None)


def request_stop(interaction_id: int) -> bool:
    """Ask a running answer to give up. True if one was listening in *this*
    process — false is not a failure, only "not running here"; the caller has
    already recorded the stop in the database, which is what makes it stick."""
    with _stops_lock:
        event = _stops.get(interaction_id)
    if event is None:
        return False
    event.set()
    return True


def _worker(
    events: "queue.Queue[Any]",
    conversation_id: str,
    interaction_id: int,
    history: list[NeutralMessage],
    question: str,
    llm: LLMClient,
) -> None:
    """Run the loop to completion and record the result. Never raises.

    Its own session, because the request's is closed the moment the response
    finishes — which, now that this outlives the response, is routinely before
    this thread is done with it.
    """
    db = SessionLocal()
    stop = _register(interaction_id)
    # What has been spent so far. Accumulated as the rounds report it, so that
    # an answer abandoned half way can still say what it cost.
    spent_in = 0
    spent_out = 0
    try:
        for event in orchestrator.answer_events(
            history=history, question=question, llm=llm
        ):
            if event["type"] == "round_thinking":
                spent_in += int(event.get("input_tokens") or 0)
                spent_out += int(event.get("output_tokens") or 0)

            # Checked here, between the orchestrator's events, which is what
            # makes the stop real rather than cosmetic: abandoning the
            # generator suspends it, so no further round is started and no
            # further request is billed. Whatever call is in flight at this
            # instant still finishes — a provider request cannot be recalled —
            # so a stop bounds the spend at the current round rather than
            # ending it mid-word.
            if stop.is_set():
                logger.info(
                    f"AI answer for {conversation_id} stopped by request "
                    f"after {spent_in} in / {spent_out} out"
                )
                _record_stop(db, conversation_id, interaction_id, spent_in, spent_out)
                events.put({"type": "stopped"})
                break

            if event["type"] != "done":
                events.put(event)
                continue

            # Persist before publishing, so a client that sees `done` and
            # immediately reloads finds the answer already stored rather than
            # racing the write.
            conversation = db.get(Conversation, conversation_id)
            interaction = db.get(Message, interaction_id)
            if conversation is None or interaction is None:
                # The thread was deleted while its answer was being written.
                logger.warning(
                    f"Conversation {conversation_id} vanished mid-answer; discarding result"
                )
                events.put(event)
                break

            # Someone stopped this while the last round was running — in
            # another process, where the Event above signals nothing. The
            # record already says `stopped`; writing the answer over it would
            # undo a decision the user has already been told was carried out.
            db.refresh(interaction)
            if interaction.status != STATUS_PENDING:
                logger.info(
                    f"Discarding answer for {conversation_id}: interaction is "
                    f"{interaction.status}, not pending"
                )
                events.put({"type": "stopped"})
                break

            store.complete_interaction(db, conversation, interaction, event, ok=True)
            db.commit()

            events.put(
                {
                    **event,
                    "conversation_id": conversation_id,
                    "interaction": {
                        "input_tokens": interaction.input_token,
                        "output_tokens": interaction.output_tokens,
                        "total_tokens": interaction.total_tokens,
                    },
                    "usage": store.usage(conversation),
                }
            )

    except Exception as exc:  # noqa: BLE001 — a worker must not die silently
        logger.exception(f"AI answer failed for conversation {conversation_id}")
        db.rollback()
        try:
            interaction = db.get(Message, interaction_id)
            if interaction is not None:
                store.fail_interaction(
                    db,
                    interaction,
                    f"The assistant could not answer that request: {type(exc).__name__}.",
                )
                db.commit()
        except Exception:  # noqa: BLE001 — nothing useful left to do
            db.rollback()
            logger.exception("Could not even record the failure")

        events.put(
            {
                "type": "error",
                "detail": f"The AI provider could not answer that request: {type(exc).__name__}.",
            }
        )
    finally:
        _unregister(interaction_id)
        events.put(_SENTINEL)
        db.close()


def _record_stop(
    db: "Session", conversation_id: str, interaction_id: int, spent_in: int, spent_out: int
) -> None:
    """Mark the interaction stopped and bank what it already cost.

    The API sets the status first, so this is usually confirming a decision
    rather than making one; what only this thread knows is the token spend, so
    that is the part worth writing. Failure here must not propagate — the work
    has already stopped, which is what was asked for.
    """
    try:
        conversation = db.get(Conversation, conversation_id)
        interaction = db.get(Message, interaction_id)
        if conversation is None or interaction is None:
            return
        store.stop_interaction(db, conversation, interaction, spent_in, spent_out)
        db.commit()
    except Exception:  # noqa: BLE001 — the stop itself already succeeded
        db.rollback()
        logger.exception(f"Could not record the stop for {conversation_id}")


def run(
    conversation_id: str,
    interaction_id: int,
    history: list[NeutralMessage],
    question: str,
    llm: LLMClient,
) -> Iterator[dict[str, Any]]:
    """Start the answer and yield its events as they happen.

    Abandoning this iterator — which is what a disconnected client does — stops
    the *watching*, not the work. The thread is not a daemon precisely so an
    answer in flight is allowed to finish and commit.
    """
    events: "queue.Queue[Any]" = queue.Queue()

    thread = threading.Thread(
        target=_worker,
        args=(events, conversation_id, interaction_id, history, question, llm),
        name=f"ai-answer-{conversation_id[:8]}",
        daemon=False,
    )
    thread.start()

    while True:
        try:
            item = events.get(timeout=_POLL_SECONDS)
        except queue.Empty:
            if thread.is_alive():
                continue
            # Gone without a sentinel — only reachable if the thread died in a
            # way its own except block could not catch.
            logger.error(f"AI worker for {conversation_id} ended without finishing")
            return
        if item is _SENTINEL:
            return
        yield item
