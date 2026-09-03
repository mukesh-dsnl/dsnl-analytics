"""
Sign in, sign out, and "who am I".

    POST /api/auth/login    check credentials, issue a session cookie
    POST /api/auth/logout   destroy the session
    GET  /api/auth/me       the signed-in user, or 401

Accounts are still inserted by hand and the password is still stored in plain
text, by decision:

    INSERT INTO users (username, password_hash) VALUES ('alice', 'secret');

The column keeps its `password_hash` name for compatibility with the existing
table; it holds a plain password. That is a deliberate trade, and it means
anyone who can read the `users` table can sign in as anyone — the database is
the security boundary for credentials here. Nothing else in the system depends
on that choice: sessions are hashed, expire, and can be revoked regardless.

What did change is how often the password matters. It is compared exactly once,
here. Every other request in the application is authenticated by a row in
`auth_sessions` — see app/api/deps.py.
"""

import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.core.config import get_settings
from app.core.database import get_db
from app.models.session import (
    AuthSession,
    expiry_from_now,
    hash_token,
    new_session_token,
    utcnow,
)
from app.models.user import User, new_user_id
from app.schemas.auth import LoginRequest, LoginResponse, MeResponse

logger = logging.getLogger(__name__)
router = APIRouter()


def _set_session_cookie(response: Response, token: str, max_age_seconds: int) -> None:
    settings = get_settings()
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=token,
        max_age=max_age_seconds,
        # HttpOnly is the reason this is a cookie and not a token in
        # localStorage: script on the page cannot read it. This application
        # renders model-generated content, so that distinction is not academic.
        httponly=True,
        secure=settings.SESSION_COOKIE_SECURE,
        samesite=settings.SESSION_COOKIE_SAMESITE,
        path="/",
    )


@router.post("/auth/login", response_model=LoginResponse)
def login(
    body: LoginRequest,
    response: Response,
    request: Request,
    db: Session = Depends(get_db),
) -> LoginResponse:
    """Exchange a username and password for a session cookie.

    401 for both an unknown user and a wrong password, with the same message:
    distinguishing them would let anyone enumerate which accounts exist.
    """
    user = db.query(User).filter(User.username == body.username).first()

    # Constant-time, and evaluated even when the user is missing, so the reply
    # takes the same time either way. `password_hash` holds a plain password
    # here — see the module docstring.
    stored = user.password_hash if user is not None else ""
    supplied = body.password
    matches = secrets.compare_digest(stored, supplied)

    if user is None or not matches:
        logger.info("Failed sign-in for username=%r", body.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )

    # Rows added by hand may predate the user_id column, or have been inserted
    # without it. A session has to point somewhere stable, so fill it in now
    # rather than refusing a login over a column the operator never saw.
    if not user.user_id:
        user.user_id = new_user_id()
        db.flush()

    settings = get_settings()
    token = new_session_token()
    session = AuthSession(
        token_hash=hash_token(token),
        user_id=user.user_id,
        username=user.username,
        created_at=utcnow(),
        expires_at=expiry_from_now(settings.SESSION_TTL_DAYS),
        last_seen_at=utcnow(),
        user_agent=(request.headers.get("user-agent") or "")[:255] or None,
    )
    db.add(session)
    db.commit()

    _set_session_cookie(response, token, settings.SESSION_TTL_DAYS * 24 * 60 * 60)
    logger.info("Signed in username=%r for %s days", user.username, settings.SESSION_TTL_DAYS)

    return LoginResponse(username=user.username, user_id=user.user_id)


@router.post("/auth/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    """Destroy the session and clear the cookie.

    Deliberately not behind the auth dependency, and deliberately not an error
    when there is no session: "make sure I am signed out" is satisfied by an
    already-signed-out caller, and a 401 here would strand a client holding a
    stale cookie with no way to clear it.
    """
    settings = get_settings()
    token = request.cookies.get(settings.SESSION_COOKIE_NAME)
    if token:
        session = db.get(AuthSession, hash_token(token))
        if session is not None:
            db.delete(session)
            db.commit()

    response.delete_cookie(
        key=settings.SESSION_COOKIE_NAME,
        path="/",
        httponly=True,
        secure=settings.SESSION_COOKIE_SECURE,
        samesite=settings.SESSION_COOKIE_SAMESITE,
    )
    return {"signed_out": True}


@router.get("/auth/me", response_model=MeResponse)
def me(user: User = Depends(current_user)) -> MeResponse:
    """Who the cookie belongs to, or 401.

    The frontend calls this once on boot. Until it answers, the client does not
    know whether it is signed in — which is a third state, distinct from "yes"
    and "no", and the one a naive implementation forgets.
    """
    return MeResponse(username=user.username, user_id=user.user_id)
