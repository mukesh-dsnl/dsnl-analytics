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

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.ai import conversations as store
from app.ai import jobs, orchestrator
from app.ai.providers.factory import ProviderNotConfigured, get_llm_client
from app.core.database import SessionLocal, get_db
from app.models.conversation import Conversation, Message

logger = logging.getLogger(__name__)
router = APIRouter()


class ChatRequest(BaseModel):
    """A question, and which conversation it belongs to."""

    question: str = Field(..., min_length=1, max_length=4000)
    # Omit to start a new thread; the response carries the id to use next time.
    conversation_id: Optional[str] = Field(None, max_length=36)
    # Who is asking. Recorded for attribution, not trusted as authentication —
    # this application's login issues no token (see app/api/auth.py).
    username: Optional[str] = Field(None, max_length=100)


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


def _answer(db: Session, body: ChatRequest, llm) -> dict[str, Any]:
    """Load, open the row, run, close the row — the flow both endpoints share.

    The interaction row is opened before the model is called and starts marked
    `fail`; it is promoted to `pass` once an answer exists. A request that dies
    mid-flight therefore leaves an honest record rather than an optimistic one.
    """
    conversation = store.get_or_create(db, body.conversation_id, body.question, body.username)
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
def chat(body: ChatRequest, db: Session = Depends(get_db)) -> ChatResponse:
    """Answer one question about the CDR/CODR data.

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
        result = _answer(db, body, llm)
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
def chat_stream(body: ChatRequest) -> StreamingResponse:
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
        conversation = store.get_or_create(
            db, body.conversation_id, body.question, body.username
        )
        history = store.load_history(db, conversation.id)
        interaction = store.start_interaction(db, conversation, body.question)
        db.commit()
        conversation_id = conversation.id
        interaction_id = interaction.id
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


# ── Reading back ───────────────────────────────────────────────────────────


@router.get("/ai/conversations", response_model=list[ConversationSummary])
def list_conversations(
    username: Optional[str] = None,
    limit: int = 30,
    db: Session = Depends(get_db),
) -> list[ConversationSummary]:
    """Recent threads, newest first. Filtered by username when one is given."""
    query = db.query(Conversation)
    if username:
        query = query.filter(Conversation.username == username)

    rows = query.order_by(Conversation.updated_at.desc()).limit(max(1, min(limit, 100))).all()

    counts = {
        conversation.id: db.query(Message)
        .filter(Message.conversation_id == conversation.id)
        .count()
        for conversation in rows
    }
    return [_summary(c, counts.get(c.id, 0)) for c in rows]


@router.get("/ai/conversations/{conversation_id}", response_model=ConversationDetail)
def get_conversation(
    conversation_id: str, db: Session = Depends(get_db)
) -> ConversationDetail:
    """One thread and its messages, oldest first — what the UI restores from."""
    conversation = db.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="No such conversation.")

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
    conversation_id: str, body: RenameRequest, db: Session = Depends(get_db)
) -> ConversationSummary:
    """Give a thread a name of its own instead of its opening question."""
    conversation = db.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="No such conversation.")

    store.rename(db, conversation, body.title)
    db.commit()

    count = db.query(Message).filter(Message.conversation_id == conversation_id).count()
    return _summary(conversation, count)


@router.delete("/ai/conversations/{conversation_id}")
def delete_conversation(conversation_id: str, db: Session = Depends(get_db)) -> dict:
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
