"""
The authentication boundary.

Everything the API exposes, except `POST /api/auth/login` and `/health`, passes
through `current_user`. It is the single place a request stops being anonymous,
which is why it is worth reading in full: any endpoint that does *not* depend on
it is public, and there should be no such endpoint by accident.

The flow is short on purpose — read the cookie, hash it, look the row up, check
it has not expired. There is nothing to decode, nothing to verify a signature
on, and no way for a client to influence the answer beyond presenting a token
that is either in the table or is not.

Failures are 401 with a reason, never 403. The distinction matters: 403 says
"you are someone, and that someone may not do this", which would be a lie when
the request carried no usable identity at all. Ownership checks elsewhere are
where 403/404 belongs.
"""

import logging

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.session import AuthSession, hash_token, utcnow
from app.models.user import User

logger = logging.getLogger(__name__)


def _unauthorised(detail: str) -> HTTPException:
    """401 with the cookie scheme named, so a client knows how to authenticate."""
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Cookie"},
    )


def get_session(request: Request, db: Session = Depends(get_db)) -> AuthSession:
    """The live session behind this request, or 401.

    An expired row is deleted as it is found. Sessions are only ever read by
    the person holding the token, so this is the natural moment to collect
    them — no sweeper job, and the table does not grow without bound.
    """
    settings = get_settings()
    token = request.cookies.get(settings.SESSION_COOKIE_NAME)
    if not token:
        raise _unauthorised("Not signed in.")

    session = db.get(AuthSession, hash_token(token))
    if session is None:
        # Either never issued, or already logged out. Both are "sign in again",
        # and saying which would confirm whether a token was ever valid.
        raise _unauthorised("Session is not valid. Please sign in again.")

    if not session.is_live():
        db.delete(session)
        db.commit()
        raise _unauthorised("Session has expired. Please sign in again.")

    # Idle tracking only. Deliberately not extending expires_at: a sliding
    # window would keep a stolen cookie alive for as long as it kept being
    # used, which is the opposite of what an expiry is for.
    session.last_seen_at = utcnow()
    db.commit()
    return session


def current_user(
    session: AuthSession = Depends(get_session), db: Session = Depends(get_db)
) -> User:
    """The signed-in user. The identity every scoped query is built from.

    A session whose user has since been deleted is itself invalid — the row is
    removed rather than left pointing at nothing.
    """
    user = db.query(User).filter(User.user_id == session.user_id).first()
    if user is None:
        logger.warning("Session %s names a user that no longer exists", session.user_id)
        db.delete(session)
        db.commit()
        raise _unauthorised("Account no longer exists.")
    return user


def require_user(user: User = Depends(current_user)) -> None:
    """Authentication with the result thrown away.

    For routers where every route needs a signed-in caller but none of them
    needs to know who it is — the dashboards, which read a parquet lake and
    have no per-user data in them. Attached once at `include_router` so the
    endpoint functions are untouched and no future route can be added to those
    modules without inheriting the guard.
    """
    return None
