"""
User model — minimal login gate (username/password). No real session
security; credentials are inserted directly into the DB (prompt4.md §3).
"""

import uuid

from sqlalchemy import BigInteger, Column, DateTime, Integer, String
from sqlalchemy.sql import func

from app.core.database import Base


def new_user_id() -> str:
    """A UUID4 as text, generated when a user row is created."""
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    # SQLite only autoincrements a plain INTEGER primary key; the variant keeps
    # BIGINT on MySQL, where this actually runs.
    id = Column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )

    # The identifier everything outside this table refers to. Separate from the
    # autoincrementing primary key on purpose: `id` is a storage detail that
    # leaks row counts and is guessable, while this is what a conversation is
    # keyed on and what could safely appear in an API response.
    #
    # `default` is applied by SQLAlchemy on insert. Rows created outside the
    # ORM — the documented way accounts are added here — need it too, so the
    # column also carries a database-side default where the engine supports
    # one; see scripts/migrate_ai_chat.py, which backfills existing rows and
    # installs a trigger on MySQL/MariaDB, whose DEFAULT cannot call UUID().
    user_id = Column(
        String(36), nullable=True, unique=True, index=True, default=new_user_id
    )

    username = Column(String(100), nullable=False, unique=True)
    password_hash = Column(String(128), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self) -> str:
        return f"<User id={self.id!r} username={self.username!r}>"
