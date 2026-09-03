"""
AI chat API — natural-language questions over the CDR/CODR lake.

    POST /api/ai/chat           ask a question, get a text answer
    POST /api/ai/chat/stream    the same, reported step by step (SSE)
    GET  /api/ai/conversations  recent threads
    GET  /api/ai/conversations/{id}   one thread's messages

The chat is **session-based**: the client holds a `conversation_id` and nothing
else. The transcript lives in the database, and the history handed to the model
is rebuilt server-side on every request (see `app/ai/conversations.py`, which
also explains why tool calls are recorded but not replayed).

This replaced a stateless design in which the browser posted the whole
transcript back each time. Three things that design could not do, and this one
can: survive a refresh, produce an auditable record of what was asked, and
attribute token spend to a conversation.

Failure modes are kept distinct on purpose:

    503  no provider configured — names the environment variable to set
    502  the provider or the loop failed — never carries a traceback

The dashboards do not depend on any of this. With no key configured every other
route behaves exactly as before and only these routes return 503.
"""

import json
import logging
from typing import Any, Iterator, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.ai import conversations as store
from app.ai import jobs, orchestrator
from app.ai.providers.factory import ProviderNotConfigured, get_llm_client
from app.api.deps import current_user
from app.core.database import SessionLocal, get_db
from app.models.conversation import STATUS_PENDING, Conversation, Message
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter()


def _no_such_conversation() -> HTTPException:
    """404 for both "does not exist" and "is not yours".

    Not 403. A 403 would confirm the thread exists, which tells the caller
    something about another user's data — the one thing scoping is meant to
    prevent. The two cases are indistinguishable from outside by design.
    """
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail="No such conversation."
    )


def _owned_or_404(db: Session, conversation_id: str, user: User) -> Conversation:
    """Fetch a conversation the caller owns, or raise 404.

    Rows written before ownership was recorded have no `user_id`. They are
    treated as unclaimed and readable rather than orphaned behind a 404 — the
    alternative is that everyone's existing history disappears the day auth is
    switched on. Nothing new can be created unowned, so this is a finite set
    that drains as those threads are used.
    """
    conversation = db.get(Conversation, conversation_id)
    if conversation is None:
        raise _no_such_conversation()
    if conversation.user_id and conversation.user_id != user.user_id:
        raise _no_such_conversation()
    return conversation


class ChatRequest(BaseModel):
    """A question, and which conversation it belongs to.

    There is no `username` field any more. It used to be here for attribution
    and was explicitly not trusted — but an untrusted field that decides which
    rows get written is a distinction without a difference once the endpoint is
    reachable. The asker now comes from the session cookie and cannot be
    asserted by the caller at all.
    """

    question: str = Field(..., min_length=1, max_length=4000)
    # Omit to start a new thread; the response carries the id to use next time.
    conversation_id: Optional[str] = Field(None, max_length=36)


class TokenUsage(BaseModel):
    """Running totals for the whole conversation, not just this question."""

    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    # At the configured rates — an estimate, not a bill. See AI_PRICE_* in
    # app/core/config.py.
    cost: float = 0.0
    currency: str = "USD"


class InteractionUsage(BaseModel):
    """What this one exchange cost, as opposed to the thread's running total."""

    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0


class ChatResponse(BaseModel):
    answer: str
    # Always present: a client that sent none gets the id of the thread it just
    # started, and must send it with the next question to be understood.
    conversation_id: str
    provider: str = ""
    model: str = ""
    # Every tool call made, in order — what the answer was actually built from.
    queries: list[dict] = Field(default_factory=list)
    # This exchange alone.
    interaction: InteractionUsage = Field(default_factory=InteractionUsage)
    # The whole thread, including this exchange.
    usage: TokenUsage = Field(default_factory=TokenUsage)


class ConversationSummary(BaseModel):
    id: str
    title: Optional[str] = None
    username: Optional[str] = None
    user_id: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    message_count: int = 0
    usage: TokenUsage = Field(default_factory=TokenUsage)


class StoredInteraction(BaseModel):
    """One exchange as stored: the question, its answer, and what it cost."""

    id: int
    status: str = "pass"
    query: str = ""
    response: str = ""
    queries: list[dict] = Field(default_factory=list)
    input_token: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    created_at: Optional[str] = None


class ConversationDetail(ConversationSummary):
    interactions: list[StoredInteraction] = Field(default_factory=list)


def _iso(value: Any) -> Optional[str]:
    return value.isoformat() if value is not None else None


def _summary(conversation: Conversation, message_count: int) -> ConversationSummary:
    return ConversationSummary(
        id=conversation.id,
        title=conversation.title,
        username=conversation.username,
        user_id=conversation.user_id,
        created_at=_iso(conversation.created_at),
        updated_at=_iso(conversation.updated_at),
        message_count=message_count,
        usage=TokenUsage(**store.usage(conversation)),
    )


# ── Asking ─────────────────────────────────────────────────────────────────


def _answer(db: Session, body: ChatRequest, llm, user: User) -> dict[str, Any]:
    """Load, open the row, run, close the row — the flow both endpoints share.

    The interaction row is opened before the model is called and starts marked
    `fail`; it is promoted to `pass` once an answer exists. A request that dies
    mid-flight therefore leaves an honest record rather than an optimistic one.
    """
    conversation = store.get_or_create(db, body.conversation_id, body.question, user)
    history = store.load_history(db, conversation.id)
    interaction = store.start_interaction(db, conversation, body.question)
    db.commit()

    try:
        result = orchestrator.answer(history=history, question=body.question, llm=llm)
    except Exception:
        # The row stays `fail` with its question intact; the caller gets a 502.
        db.commit()
        raise

    store.complete_interaction(db, conversation, interaction, result, ok=True)
    db.commit()

    return {
        **result,
        "conversation_id": conversation.id,
        "interaction": {
            "input_tokens": interaction.input_token,
            "output_tokens": interaction.output_tokens,
            "total_tokens": interaction.total_tokens,
        },
        "usage": store.usage(conversation),
    }


@router.post("/ai/chat", response_model=ChatResponse)
def chat(
    body: ChatRequest,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> ChatResponse:
    """Answer one question about the CDR/CODR data, for the signed-in user.

    The model may call tools while working; every call it made comes back in
    `queries`, so an answer can be traced to the query behind it. An empty
    `queries` array on a substantive answer means the model declined to look —
    which is the correct behaviour for a question this data can't answer.
    """
    try:
        llm = get_llm_client()
    except ProviderNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    try:
        result = _answer(db, body, llm, user)
    except store.NotOwned:
        db.rollback()
        raise _no_such_conversation()
    except Exception as exc:  # noqa: BLE001 — nothing internal may reach the client
        db.rollback()
        logger.exception("AI chat failed")
        raise HTTPException(
            status_code=502,
            detail=f"The AI provider could not answer that request: {type(exc).__name__}.",
        )

    return ChatResponse(
        answer=result.get("answer", ""),
        conversation_id=result["conversation_id"],
        provider=result.get("provider", ""),
        model=result.get("model", ""),
        queries=result.get("queries", []),
        interaction=InteractionUsage(**result["interaction"]),
        usage=TokenUsage(**result["usage"]),
    )


@router.post("/ai/chat/stream")
def chat_stream(
    body: ChatRequest, user: User = Depends(current_user)
) -> StreamingResponse:
    """The same answer, reported as it is worked out.

    Server-sent events, because a question can take several rounds and tens of
    seconds against a network share, and a blocking POST leaves the client with
    nothing to show for that time but a spinner. Each event says what the model
    is doing and how long the last step took, so the wait is legible rather
    than merely long.

    POST rather than GET (so EventSource can't be used, and the client reads
    the body itself): the question and the conversation id go up with the
    request, which does not belong in a URL.

    The provider is resolved *before* the response begins. Once the first byte
    is out the status code is fixed, so an unconfigured provider has to fail as
    a normal 503 here rather than as an error event nobody checks for.

    The answer itself runs on its own thread (see app/ai/jobs.py) and this
    generator only watches it. That is what makes a refresh survivable: closing
    the browser ends the watching, not the work, and the answer is committed
    whether or not anyone is still listening. A client that comes back finds
    the interaction `pending` and polls for it.
    """
    try:
        client = get_llm_client()
    except ProviderNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    # Opened and closed here, before any streaming: the row has to exist (and
    # be committed) before the worker starts, and this session must not still
    # be open while the worker holds its own.
    db = SessionLocal()
    try:
        conversation = store.get_or_create(db, body.conversation_id, body.question, user)
        history = store.load_history(db, conversation.id)
        interaction = store.start_interaction(db, conversation, body.question)
        db.commit()
        conversation_id = conversation.id
        interaction_id = interaction.id
    except store.NotOwned:
        db.rollback()
        raise _no_such_conversation()
    except Exception:
        db.rollback()
        logger.exception("Could not open the interaction")
        raise HTTPException(status_code=502, detail="The conversation could not be started.")
    finally:
        db.close()

    def events() -> Iterator[str]:
        # Sent before any work, so the client can adopt the id immediately — a
        # browser that navigates away mid-answer still knows which thread to
        # come back to.
        yield f"data: {json.dumps({'type': 'conversation', 'conversation_id': conversation_id})}\n\n"

        for event in jobs.run(
            conversation_id=conversation_id,
            interaction_id=interaction_id,
            history=history,
            question=body.question,
            llm=client,
        ):
            yield f"data: {json.dumps(event, default=str)}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # nginx buffers proxied responses by default, which would hold the
            # whole stream back and defeat the point of sending it early.
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/ai/conversations/{conversation_id}/stop")
def stop_answer(
    conversation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    """Abandon the answer being worked out in one of your own threads.

    A real stop, not a cosmetic one. Closing the browser deliberately does
    *not* cancel an answer — that is what makes a refresh survivable — so
    giving up has to be asked for, and this is the asking.

    The status is written here rather than left to the worker so that the
    decision holds even if the worker is in another process, or has already
    moved on: whatever it produces afterwards is discarded rather than written
    over this. The worker adds the token spend, which only it knows.

    Idempotent. Stopping a thread with nothing running reports zero stopped
    rather than erroring — the caller's intent ("do not continue") is already
    satisfied, and a client that pressed the button twice has not done wrong.
    """
    conversation = _owned_or_404(db, conversation_id, user)

    pending = (
        db.query(Message)
        .filter(Message.conversation_id == conversation.id)
        .filter(Message.status == STATUS_PENDING)
        .all()
    )

    for interaction in pending:
        store.stop_interaction(db, conversation, interaction)
    db.commit()

    # After the commit, so a worker that reads the row on this signal sees the
    # decision already recorded rather than racing it.
    signalled = sum(1 for row in pending if jobs.request_stop(row.id))

    logger.info(
        f"Stop requested for {conversation_id}: {len(pending)} pending, {signalled} signalled"
    )
    return {"stopped": len(pending)}


# ── Reading back ───────────────────────────────────────────────────────────


@router.get("/ai/conversations", response_model=list[ConversationSummary])
def list_conversations(
    limit: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> list[ConversationSummary]:
    """The signed-in user's threads, newest first.

    The `username` query parameter is gone. It used to decide the filter, which
    meant passing someone else's name returned their threads and passing none
    returned everybody's. The owner now comes from the session and there is no
    way to ask for anyone else's list.
    """
    rows = (
        db.query(Conversation)
        .filter(Conversation.user_id == user.user_id)
        .order_by(Conversation.updated_at.desc())
        .limit(limit)
        .all()
    )

    counts = {
        conversation.id: db.query(Message)
        .filter(Message.conversation_id == conversation.id)
        .count()
        for conversation in rows
    }
    return [_summary(c, counts.get(c.id, 0)) for c in rows]


@router.get("/ai/conversations/{conversation_id}", response_model=ConversationDetail)
def get_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> ConversationDetail:
    """One of the caller's threads and its messages, oldest first.

    Someone else's thread is a 404, exactly as a nonexistent one is. That is
    the whole difference between this and what it replaced, which returned any
    thread to anyone who knew its id.
    """
    conversation = _owned_or_404(db, conversation_id, user)

    rows = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.id.asc())
        .all()
    )

    interactions = [
        StoredInteraction(
            id=row.id,
            status=row.status,
            query=row.query or "",
            response=row.response or "",
            queries=row.queries or [],
            input_token=row.input_token or 0,
            output_tokens=row.output_tokens or 0,
            total_tokens=row.total_tokens,
            created_at=_iso(row.created_at),
        )
        for row in rows
    ]

    base = _summary(conversation, len(rows))
    return ConversationDetail(**base.model_dump(), interactions=interactions)


class RenameRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)


@router.patch("/ai/conversations/{conversation_id}", response_model=ConversationSummary)
def rename_conversation(
    conversation_id: str,
    body: RenameRequest,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> ConversationSummary:
    """Give one of your own threads a name instead of its opening question."""
    conversation = _owned_or_404(db, conversation_id, user)

    store.rename(db, conversation, body.title)
    db.commit()

    count = db.query(Message).filter(Message.conversation_id == conversation_id).count()
    return _summary(conversation, count)


@router.delete("/ai/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    """Remove a thread from the list — by moving it, not destroying it.

    The conversation and its whole transcript are copied into
    `deleted_conversations` and then removed from the live tables, in one
    transaction. Nothing is lost: the record stays available for audit, for
    token spend that has already been billed, and for restoring a thread
    dropped by mistake.
    """
    conversation = db.get(Conversation, conversation_id)
    if conversation is None:
        # Already gone, by this call or an earlier one. Reporting success is
        # the honest answer to "make sure this is not in my list".
        return {"deleted": conversation_id, "archived": False}

    # Somebody else's thread reads as already-absent, the same as a thread that
    # never existed. Idempotent success would be a lie here — it would report
    # having removed something the caller cannot see and which is still there.
    if conversation.user_id and conversation.user_id != user.user_id:
        raise _no_such_conversation()

    try:
        store.archive(db, conversation)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception(f"Archiving conversation {conversation_id} failed")
        raise HTTPException(
            status_code=500,
            detail="The conversation could not be archived, so it was left in place.",
        )

    return {"deleted": conversation_id, "archived": True}
