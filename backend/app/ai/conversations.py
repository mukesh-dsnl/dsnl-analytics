"""
Reading and writing chat memory.

The API takes a `conversation_id` and this module rebuilds the history from the
database, so the browser holds an identifier rather than the conversation
itself.

**Only the last `CONTEXT_INTERACTIONS` exchanges are replayed.** The whole
transcript is kept — it is the record — but a long thread must not be resent in
full on every question. Each round of the tool loop already carries a system
prompt of several thousand tokens, and an unbounded history multiplies that by
the length of the conversation. Ten exchanges is enough for the follow-ups
people actually ask ("and how many were not connected?") without the cost of a
question growing with the age of the thread.

**What is replayed to the model, and what is only recorded.** These are not the
same set, and the difference is deliberate:

  * Replayed: the questions and answers, as plain text.
  * Recorded but not replayed: the tool calls behind each answer.

Tool calls are not replayed because a stored tool call cannot be re-sent
safely. Anthropic pairs every `tool_use` with a `tool_result` in the same
exchange and rejects a dangling one; Gemini goes further and rejects a replayed
function call whose `thought_signature` is missing — and that signature is
opaque, per-turn state that this module has no business persisting (see
`providers/gemini_provider.py`). Replaying yesterday's tool calls would
therefore break the request outright on two of the three providers.

The answers themselves already contain the figures those calls produced, so
the model loses nothing it needs for a follow-up question.
"""

import logging
from typing import Any

from sqlalchemy.orm import Session

from app.ai.providers.base import NeutralMessage
from app.core.config import get_settings
from app.models.conversation import (
    STATUS_FAIL,
    STATUS_PASS,
    Conversation,
    DeletedConversation,
    Message,
    new_conversation_id,
)
from app.models.user import User

logger = logging.getLogger(__name__)

# Enough of the opening question to recognise the thread in a list.
TITLE_LENGTH = 120

# How many past exchanges go back to the model. See the module docstring.
CONTEXT_INTERACTIONS = 10


def _resolve_user(db: Session, username: str | None) -> tuple[str | None, str | None]:
    """Map an asserted username to its UUID, if it names a real account.

    An unknown username is kept as text rather than rejected: it is a label on
    a conversation, not a permission check, and this application has no session
    token that would make it one.
    """
    if not username:
        return None, None
    user = db.query(User).filter(User.username == username).first()
    return (user.user_id if user else None), username


def get_or_create(
    db: Session, conversation_id: str | None, question: str, username: str | None = None
) -> Conversation:
    """Fetch the named conversation, or start one.

    An unknown id starts a new conversation under *that* id rather than
    erroring: the client already believes it owns that thread, and handing back
    a different id would silently split the transcript in two.
    """
    if conversation_id:
        existing = db.get(Conversation, conversation_id)
        if existing is not None:
            return existing

    user_id, name = _resolve_user(db, username)
    conversation = Conversation(
        id=conversation_id or new_conversation_id(),
        user_id=user_id,
        username=name,
        title=question.strip()[:TITLE_LENGTH] or None,
    )
    db.add(conversation)
    db.flush()  # so the id is usable for the rows written in this request
    return conversation


def load_history(db: Session, conversation_id: str) -> list[NeutralMessage]:
    """The recent conversation, in the shape the orchestrator speaks.

    The last `CONTEXT_INTERACTIONS` exchanges, oldest first. Text only — see
    the module docstring for why the stored tool calls stay out of what is
    replayed.
    """
    # Newest first, capped, then reversed: the alternative — reading every row
    # and slicing in Python — costs the whole thread on every question, which
    # is the expense this window exists to avoid.
    recent = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.id.desc())
        .limit(CONTEXT_INTERACTIONS)
        .all()
    )

    history: list[NeutralMessage] = []
    for row in reversed(recent):
        if row.query:
            history.append(NeutralMessage(role="user", text=row.query))
        # A failed interaction contributes its question but no answer: there is
        # nothing to replay, and inventing one would put words in the
        # assistant's mouth.
        if row.response and row.status == STATUS_PASS:
            history.append(NeutralMessage(role="assistant", text=row.response))
    return history


def start_interaction(db: Session, conversation: Conversation, question: str) -> Message:
    """Open the row for this exchange, before the model is called.

    Written first, not last, so a question that crashes the provider is still
    on record — those are the ones worth being able to look up. It starts as
    `fail` and is promoted on success, which means a request that dies
    mid-flight leaves an honest row rather than an optimistic one.
    """
    message = Message(
        conversation_id=conversation.id,
        status=STATUS_FAIL,
        query=question,
        response=None,
    )
    db.add(message)
    db.flush()
    return message


def complete_interaction(
    db: Session,
    conversation: Conversation,
    message: Message,
    result: dict[str, Any],
    ok: bool = True,
) -> Message:
    """Fill in the answer and add its cost to the conversation."""
    input_tokens = int(result.get("input_tokens") or 0)
    output_tokens = int(result.get("output_tokens") or 0)

    message.status = STATUS_PASS if ok else STATUS_FAIL
    message.response = result.get("answer", "")
    message.input_token = input_tokens
    message.output_tokens = output_tokens
    # Recorded, not replayed.
    message.queries = result.get("queries", [])

    # `or 0` guards a row written before these columns had a default.
    conversation.input_tokens = (conversation.input_tokens or 0) + input_tokens
    conversation.output_tokens = (conversation.output_tokens or 0) + output_tokens

    logger.info(
        f"AI conversation {conversation.id}: {message.status} "
        f"+{input_tokens} in / +{output_tokens} out "
        f"(total {conversation.input_tokens}/{conversation.output_tokens})"
    )
    return message


# ── Renaming and deleting ──────────────────────────────────────────────────


def rename(db: Session, conversation: Conversation, title: str) -> Conversation:
    """Give a thread a name of its own instead of its opening question."""
    conversation.title = title.strip()[:TITLE_LENGTH] or None
    return conversation


def archive(db: Session, conversation: Conversation) -> DeletedConversation:
    """Move a conversation into the archive, transcript and all.

    A move, not a destruction. The whole thread is snapshotted first because
    `messages` cascades from `conversations`: removing the original row takes
    its interactions with it, so anything not copied beforehand is gone. Doing
    it in this order is what makes the delete lossless.

    The caller commits; that keeps the copy and the removal in one transaction,
    so a failure halfway cannot leave the thread in neither table.
    """
    rows = (
        db.query(Message)
        .filter(Message.conversation_id == conversation.id)
        .order_by(Message.id.asc())
        .all()
    )

    snapshot = [
        {
            "id": row.id,
            "status": row.status,
            "query": row.query,
            "response": row.response,
            "input_token": row.input_token or 0,
            "output_tokens": row.output_tokens or 0,
            "queries": row.queries or [],
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]

    deleted = DeletedConversation(
        id=conversation.id,
        user_id=conversation.user_id,
        username=conversation.username,
        title=conversation.title,
        input_tokens=conversation.input_tokens or 0,
        output_tokens=conversation.output_tokens or 0,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        messages=snapshot,
    )
    db.add(deleted)
    db.flush()

    db.delete(conversation)

    logger.info(
        f"AI conversation {deleted.id} archived: {len(snapshot)} interaction(s), "
        f"{deleted.total_tokens} tokens"
    )
    return deleted


# ── Cost ───────────────────────────────────────────────────────────────────


def cost_of(input_tokens: int, output_tokens: int) -> float:
    """What those tokens cost, at the configured rates.

    Input and output are priced separately because every provider prices them
    separately, usually with output several times dearer — averaging the two
    would understate exactly the conversations that ran long.
    """
    settings = get_settings()
    return (
        input_tokens * settings.AI_PRICE_INPUT_PER_MTOK
        + output_tokens * settings.AI_PRICE_OUTPUT_PER_MTOK
    ) / 1_000_000


def usage(conversation: Conversation) -> dict[str, Any]:
    """The conversation's running totals and cost, for the API response."""
    settings = get_settings()
    input_tokens = conversation.input_tokens or 0
    output_tokens = conversation.output_tokens or 0
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
        "cost": round(cost_of(input_tokens, output_tokens), 6),
        "currency": settings.AI_PRICE_CURRENCY,
    }
