"""Schemas for sign-in and session identity."""

from typing import Optional

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=1, max_length=200)


class LoginResponse(BaseModel):
    success: bool = True
    username: str
    # The stable public identifier. Everything the signed-in user owns is
    # scoped by this, never by the username, which is only a label.
    user_id: Optional[str] = None


class MeResponse(BaseModel):
    """What GET /api/auth/me returns. No session details: the client has no use
    for the token's expiry and cannot act on it, and echoing it back would put
    session state somewhere it can go stale."""

    username: str
    user_id: Optional[str] = None
