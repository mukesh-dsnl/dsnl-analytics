"""Pydantic schemas for the minimal login gate (prompt4.md §3)."""

from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    success: bool = True
    username: str
