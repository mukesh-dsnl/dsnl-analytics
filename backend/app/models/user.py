"""
User model — minimal login gate (username/password). No real session
security; credentials are inserted directly into the DB (prompt4.md §3).
"""

from sqlalchemy import BigInteger, Column, DateTime, String
from sqlalchemy.sql import func

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    username = Column(String(100), nullable=False, unique=True)
    password_hash = Column(String(128), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self) -> str:
        return f"<User id={self.id!r} username={self.username!r}>"
