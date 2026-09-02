"""
Server-side chat memory: conversations and the interactions within them.

The chat was stateless — the browser held the whole transcript and posted it
back with every question. That works until you want any of the three things
this table pair exists for: a conversation that survives a refresh, a record of
what the assistant was actually asked, and a token bill you can attribute to
someone. None of those can live in the client, because the client is not a
place you can audit.

**A row is one interaction, not one turn.** The question and the answer it
produced share a row, along with the tokens each side cost. That is the unit
everything here actually works in: the context window is "the last N
interactions", the cost of an exchange is a single row's two numbers, and a
question whose answer failed is one row marked `fail` rather than a user row
with nothing after it.

Two tables rather than one. Interactions are append-only and numerous; the
running token totals belong to the conversation and are updated in place.
Keeping them apart means answering "what has this chat cost" is a single-row
read rather than an aggregate over every message in it.
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
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base

# Message.status
#
# `pending` is not decoration: without it an interaction still being worked on
# and one that gave up look identical, so a client reloading mid-answer cannot
# tell whether to wait or to give up too.
STATUS_PENDING = "pending"
STATUS_PASS = "pass"
STATUS_FAIL = "fail"


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

    # The user's UUID (users.user_id), not the users table's primary key.
    # Nullable, and deliberately not a foreign key constraint: this
    # application's login returns no token, so the caller's identity arrives as
    # a username it asserts about itself. Recording it is useful for
    # attribution; treating it as proof of anything would be a mistake.
    user_id = Column(String(36), nullable=True, index=True)
    username = Column(String(100), nullable=True)

    # The opening question, trimmed — enough to list past chats without reading
    # every interaction row.
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
    """One interaction: a question, its answer, and what the pair cost."""

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

    # "pending" while the answer is being worked out, "pass" once one exists,
    # "fail" when the provider or the loop gave out. A failed interaction is
    # still a row: it is the one you want to find later, and dropping it would
    # make the transcript disagree with what the user saw.
    status = Column(String(8), nullable=False, default=STATUS_PENDING)

    query = Column(Text, nullable=False)
    response = Column(Text, nullable=True)

    # Named as the schema specifies: singular for input, plural for output.
    input_token = Column(Integer, nullable=False, default=0)
    output_tokens = Column(Integer, nullable=False, default=0)

    # The tool calls behind this answer — recorded for the UI trace and the
    # audit trail, never replayed to the model (see app/ai/conversations.py).
    queries = Column(JSON, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    conversation = relationship("Conversation", back_populates="messages")

    @property
    def total_tokens(self) -> int:
        return (self.input_token or 0) + (self.output_tokens or 0)

    # Every read of this table is "the interactions of one conversation, in
    # order", which is exactly this index.
    __table_args__ = (Index("ix_messages_conversation_id", "conversation_id", "id"),)

    def __repr__(self) -> str:
        return (
            f"<Message id={self.id!r} conv={self.conversation_id!r} "
            f"status={self.status!r}>"
        )


class DeletedConversation(Base):
    """A conversation the user removed from their list, kept in full.

    Deleting a chat is a move, not a destruction: the row lands here with its
    whole transcript, so the record survives for audit, for token accounting
    that has already been billed, and for restoring a thread someone dropped by
    mistake.

    The transcript rides along as JSON rather than staying in `messages`,
    because `messages` cascades from `conversations` — removing the original
    row takes its messages with it. Snapshotting first is what makes the move
    lossless. Everything worth *querying* across deleted chats (who, when,
    what it cost, what it was called) stays a real column.
    """

    __tablename__ = "deleted_conversations"

    # The original conversation's id, preserved — this is the same thread, in
    # a different place, not a new record about it.
    id = Column(String(36), primary_key=True)

    user_id = Column(String(36), nullable=True, index=True)
    username = Column(String(100), nullable=True)
    title = Column(String(200), nullable=True)

    input_tokens = Column(Integer, nullable=False, default=0)
    output_tokens = Column(Integer, nullable=False, default=0)

    # The conversation's own timestamps, carried over so the archive still
    # says when the chat happened rather than only when it was deleted.
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True)
    deleted_at = Column(DateTime(timezone=True), server_default=func.now())

    # [{id, status, query, response, input_token, output_tokens, queries,
    #   created_at}, ...] — every interaction, in order.
    messages = Column(JSON, nullable=True)

    @property
    def total_tokens(self) -> int:
        return (self.input_tokens or 0) + (self.output_tokens or 0)

    def __repr__(self) -> str:
        return f"<DeletedConversation id={self.id!r} title={self.title!r}>"
