"""
Minimal login gate (prompt4.md §3) — no session/JWT, just a credential
check against the users table. Credentials are inserted directly into the
DB (no self-service registration): INSERT INTO users (username,
password_hash) VALUES ('alice', SHA2('secret', 256)).
"""

import hashlib

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.user import User
from app.schemas.auth import LoginRequest, LoginResponse

router = APIRouter()


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


@router.post("/auth/login", response_model=LoginResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    user = db.query(User).filter(User.username == body.username).first()
    if user is None or user.password_hash != body.password:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return LoginResponse(username=user.username)
