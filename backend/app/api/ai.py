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
from app.ai import orchestrator
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


class ChatResponse(BaseModel):
    answer: str
    # Always present: a client that sent none gets the id of the thread it just
    # started, and must send it with the next question to be understood.
    conversation_id: str
    provider: str = ""
    model: str = ""
    # Every tool call made, in order — what the answer was actually built from.
    queries: list[dict] = Field(default_factory=list)
    usage: TokenUsage = Field(default_factory=TokenUsage)


class ConversationSummary(BaseModel):
    id: str
    title: Optional[str] = None
    username: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    message_count: int = 0
    usage: TokenUsage = Field(default_factory=TokenUsage)


class StoredMessage(BaseModel):
    id: int
    role: str
    text: str = ""
    queries: list[dict] = Field(default_factory=list)
    created_at: Optional[str] = None


class ConversationDetail(ConversationSummary):
    messages: list[StoredMessage] = Field(default_factory=list)


def _iso(value: Any) -> Optional[str]:
    return value.isoformat() if value is not None else None


def _summary(conversation: Conversation, message_count: int) -> ConversationSummary:
    return ConversationSummary(
        id=conversation.id,
        title=conversation.title,
        username=conversation.username,
        created_at=_iso(conversation.created_at),
        updated_at=_iso(conversation.updated_at),
        message_count=message_count,
        usage=TokenUsage(**store.usage(conversation)),
    )


# ── Asking ─────────────────────────────────────────────────────────────────


def _answer(db: Session, body: ChatRequest, llm) -> dict[str, Any]:
    """Load, record, run, record — the flow both endpoints share.

    The question is written before the model is called so that a question which
    crashes the provider is still on record; the answer and its token cost are
    written after, in one commit.
    """
    conversation = store.get_or_create(db, body.conversation_id, body.question, body.username)
    history = store.load_history(db, conversation.id)
    store.save_question(db, conversation, body.question)
    db.commit()

    result = orchestrator.answer(history=history, question=body.question, llm=llm)

    store.save_answer(db, conversation, result)
    db.commit()

    return {
        **result,
        "conversation_id": conversation.id,
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

    The session is opened by hand rather than through `Depends(get_db)`: this
    body outlives the request handler, and a dependency-scoped session would be
    closed before the generator had finished writing the answer to it.
    """
    try:
        client = get_llm_client()
    except ProviderNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    def events() -> Iterator[str]:
        db = SessionLocal()
        try:
            conversation = store.get_or_create(
                db, body.conversation_id, body.question, body.username
            )
            history = store.load_history(db, conversation.id)
            store.save_question(db, conversation, body.question)
            db.commit()

            # Sent before any work, so the client can adopt the id immediately
            # — a browser that navigates away mid-answer still knows which
            # thread to resume.
            yield f"data: {json.dumps({'type': 'conversation', 'conversation_id': conversation.id})}\n\n"

            for event in orchestrator.answer_events(
                history=history, question=body.question, llm=client
            ):
                if event["type"] == "done":
                    store.save_answer(db, conversation, event)
                    db.commit()
                    event = {
                        **event,
                        "conversation_id": conversation.id,
                        "usage": store.usage(conversation),
                    }
                yield f"data: {json.dumps(event, default=str)}\n\n"

        except Exception as exc:  # noqa: BLE001 — the stream must end cleanly
            db.rollback()
            logger.exception("AI chat stream failed")
            # Too late for a status code; the client watches for this type.
            failure = {
                "type": "error",
                "detail": f"The AI provider could not answer that request: {type(exc).__name__}.",
            }
            yield f"data: {json.dumps(failure)}\n\n"
        finally:
            db.close()

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

    messages = []
    for row in rows:
        content = row.content if isinstance(row.content, dict) else {}
        messages.append(
            StoredMessage(
                id=row.id,
                role=row.role,
                text=content.get("text", ""),
                queries=content.get("queries", []) or [],
                created_at=_iso(row.created_at),
            )
        )

    base = _summary(conversation, len(rows))
    return ConversationDetail(**base.model_dump(), messages=messages)
