"""
Reading and writing chat memory.

The API used to take the whole transcript from the client and hand it straight
to the model. Now it takes a `conversation_id`, and this module rebuilds the
history from the database — so the browser holds an identifier rather than the
conversation itself.

**What is replayed to the model, and what is only recorded.** These are not the
same set, and the difference is deliberate:

  * Replayed: the user's questions and the assistant's answers, as plain text.
  * Recorded but not replayed: the tool calls behind each answer.

Tool calls are not replayed because a stored tool call cannot be re-sent
safely. Anthropic pairs every `tool_use` with a `tool_result` in the same
exchange and rejects a dangling one; Gemini goes further and rejects a replayed
function call whose `thought_signature` is missing — and that signature is
opaque, per-turn state that this module has no business persisting (see
`providers/gemini_provider.py`). Replaying yesterday's tool calls would
therefore break the request outright on two of the three providers.

The answers themselves already contain the figures those calls produced, so
the model loses nothing it needs for a follow-up question. What the stored
calls are for is the record: the UI shows them under each answer, and the audit
trail needs them.
"""

import logging
from typing import Any

from sqlalchemy.orm import Session

from app.ai.providers.base import NeutralMessage
from app.models.conversation import Conversation, Message, new_conversation_id
from app.models.user import User

logger = logging.getLogger(__name__)

# Enough of the opening question to recognise the thread in a list.
TITLE_LENGTH = 120


def _resolve_user(db: Session, username: str | None) -> tuple[int | None, str | None]:
    """Map an asserted username to a user row, if it names one.

    An unknown username is kept as text rather than rejected: it is a label on
    a conversation, not a permission check, and this application has no session
    token that would make it one.
    """
    if not username:
        return None, None
    user = db.query(User).filter(User.username == username).first()
    return (user.id if user else None), username


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
    db.flush()  # so the id is usable for the messages written in this request
    return conversation


def load_history(db: Session, conversation_id: str) -> list[NeutralMessage]:
    """The conversation so far, in the shape the orchestrator speaks.

    Text turns only — see the module docstring for why the stored tool calls
    stay out of what is replayed.
    """
    rows = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.id.asc())
        .all()
    )

    history: list[NeutralMessage] = []
    for row in rows:
        content = row.content if isinstance(row.content, dict) else {}
        text = content.get("text")
        if not text:
            # A turn with no prose carries nothing the model can read.
            continue
        history.append(
            NeutralMessage(role="user" if row.role == "user" else "assistant", text=text)
        )
    return history


def save_question(db: Session, conversation: Conversation, question: str) -> Message:
    """Record the user's turn.

    Written before the model is called, not after, so a question that crashes
    the provider is still on record — those are the ones worth being able to
    look up.
    """
    message = Message(
        conversation_id=conversation.id, role="user", content={"text": question}
    )
    db.add(message)
    return message


def save_answer(
    db: Session,
    conversation: Conversation,
    result: dict[str, Any],
) -> Message:
    """Record the assistant's turn and add its cost to the conversation."""
    input_tokens = int(result.get("input_tokens") or 0)
    output_tokens = int(result.get("output_tokens") or 0)

    message = Message(
        conversation_id=conversation.id,
        role="assistant",
        content={
            "text": result.get("answer", ""),
            # Recorded, not replayed.
            "queries": result.get("queries", []),
            "provider": result.get("provider", ""),
            "model": result.get("model", ""),
        },
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )
    db.add(message)

    # `or 0` guards a row written before these columns had a default.
    conversation.input_tokens = (conversation.input_tokens or 0) + input_tokens
    conversation.output_tokens = (conversation.output_tokens or 0) + output_tokens

    logger.info(
        f"AI conversation {conversation.id}: +{input_tokens} in / +{output_tokens} out "
        f"(total {conversation.input_tokens}/{conversation.output_tokens})"
    )
    return message


def usage(conversation: Conversation) -> dict[str, int]:
    """The conversation's running token totals, for the API response."""
    return {
        "input_tokens": conversation.input_tokens or 0,
        "output_tokens": conversation.output_tokens or 0,
        "total_tokens": conversation.total_tokens,
    }
