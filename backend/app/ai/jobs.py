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

Deliberately no cross-request registry. A reconnecting client does not
re-attach to a running job, it polls for the result (the interaction is
`pending` until it lands). Re-attaching would need buffering, replay, and — with
more than one worker process — a shared broker, which is a great deal of
machinery for the ability to watch a progress line you have already seen.
"""

import logging
import queue
import threading
from typing import Any, Iterator

from app.ai import conversations as store
from app.ai import orchestrator
from app.ai.providers.base import LLMClient, NeutralMessage
from app.core.database import SessionLocal
from app.models.conversation import Conversation, Message

logger = logging.getLogger(__name__)

# Put on the queue when the worker is finished, so the reader stops waiting.
_SENTINEL = object()

# How long a reader waits on an empty queue before checking whether the worker
# is still alive. Only bounds how quickly a dead worker is noticed.
_POLL_SECONDS = 0.5


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
    try:
        for event in orchestrator.answer_events(
            history=history, question=question, llm=llm
        ):
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
        events.put(_SENTINEL)
        db.close()


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
