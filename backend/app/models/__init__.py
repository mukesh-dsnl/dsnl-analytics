"""SQLAlchemy models — import all models here for Alembic auto-discovery."""

from app.models.user import User

__all__ = [
    "User",
]
