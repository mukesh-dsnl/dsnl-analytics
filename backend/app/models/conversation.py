"""
Server-side chat memory: conversations and their messages.

The chat was stateless — the browser held the whole transcript and posted it
back with every question. That works until you want any of the three things
this table pair exists for: a conversation that survives a refresh, a record of
what the assistant was actually asked, and a token bill you can attribute to
someone. None of those can live in the client, because the client is not a
place you can audit.

Two tables rather than one. Messages are append-only and numerous; the running
token totals belong to the conversation and are updated in place. Keeping them
apart means answering "how many tokens has this chat cost" is a single-row read
rather than an aggregate over every message in it.

`content` is JSON, not text, because a message is not only prose: an assistant
turn also carries the tool calls behind it, and those are structured. Storing
them as JSON keeps the record faithful without a second table for tool calls
that nothing would query independently.
"""

import uuid

from sqlalchemy import (
    JSON,
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


def new_conversation_id() -> str:
    """A UUID4 as text.

    Text rather than an autoincrementing integer because the client holds this
    and sends it back: a guessable id would let one browser resume another's
    conversation, and this application has no session token that would stop it.
    """
    return str(uuid.uuid4())


class Conversation(Base):
    """One chat thread, and what it has cost so far."""

    __tablename__ = "conversations"

    id = Column(String(36), primary_key=True, default=new_conversation_id)

    # Nullable, and deliberately not enforced as a foreign key constraint: this
    # application's login returns no token, so the caller's identity arrives as
    # a username it asserts about itself. Recording it is useful for
    # attribution; treating it as proof of anything would be a mistake.
    user_id = Column(BigInteger, nullable=True, index=True)
    username = Column(String(100), nullable=True)

    # The opening question, trimmed — enough to list past chats without reading
    # every message row.
    title = Column(String(200), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Running totals across every round of every question in this thread. A
    # multi-round answer adds several turns' worth, which is exactly the point:
    # the tool loop is where the tokens actually go.
    input_tokens = Column(Integer, nullable=False, default=0)
    output_tokens = Column(Integer, nullable=False, default=0)

    messages = relationship(
        "Message",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.id",
    )

    @property
    def total_tokens(self) -> int:
        return (self.input_tokens or 0) + (self.output_tokens or 0)

    def __repr__(self) -> str:
        return (
            f"<Conversation id={self.id!r} tokens="
            f"{self.input_tokens}/{self.output_tokens}>"
        )


class Message(Base):
    """One turn in a conversation, in the order it happened."""

    __tablename__ = "messages"

    # SQLite only autoincrements a plain INTEGER primary key, so the variant
    # keeps BIGINT on MySQL (where this actually runs) while letting the test
    # suite build the same schema on an in-memory database.
    id = Column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    conversation_id = Column(
        String(36), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )

    role = Column(String(16), nullable=False)  # "user" | "assistant"

    # {"text": str, "queries": [...], "provider": str, "model": str}
    # Free-form on purpose: what an assistant turn is worth recording changes
    # as the tools do, and a schema migration per tool would be absurd.
    content = Column(JSON, nullable=False)

    # Per-turn cost, so a single expensive question is visible rather than
    # averaged into the conversation's running total.
    input_tokens = Column(Integer, nullable=False, default=0)
    output_tokens = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    conversation = relationship("Conversation", back_populates="messages")

    # Every read of this table is "the messages of one conversation, oldest
    # first", which is exactly this index.
    __table_args__ = (Index("ix_messages_conversation_id", "conversation_id", "id"),)

    def __repr__(self) -> str:
        return f"<Message id={self.id!r} conv={self.conversation_id!r} role={self.role!r}>"
