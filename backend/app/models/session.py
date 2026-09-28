"""
Login sessions.

The `users` table is unchanged and stays manually populated — usernames and
passwords are inserted by hand, in plain text. What changes is that a password
is now checked exactly once, at `POST /api/auth/login`, and every request after
that is authenticated by a row in *this* table instead of by anything the
client asserts about itself.

That is the whole point of the split: identity stops being a claim the browser
repeats on each request and becomes a fact the server can look up, expire, and
revoke.

Two decisions worth stating outright:

**The token is stored hashed.** The cookie carries a 256-bit random value; what
lands in this table is its SHA-256. A dump of this table therefore contains no
usable credentials — the rows can be read, but not replayed. Hashing is safe
here (unlike for passwords) because the input is full-entropy random, so there
is nothing to brute-force and no need for a slow KDF.

**Expiry is a stored column, not a computed one.** `expires_at` is written when
the session is issued, from SESSION_TTL_DAYS at that moment. Lowering the
setting later does not retroactively shorten sessions already handed out, and
raising it does not extend them. The row is the authority; the setting only
decides what the next row gets.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import Column, DateTime, Index, String

from app.core.database import Base

# 32 bytes of urandom, url-safe base64 — ~43 characters in the cookie.
TOKEN_BYTES = 32


def new_session_token() -> str:
    """The secret the browser holds. Never stored; only its hash is."""
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_token(token: str) -> str:
    """What goes in the table. SHA-256 of the raw token, hex encoded."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def utcnow() -> datetime:
    """Timezone-aware UTC.

    Everything here compares against this rather than `datetime.utcnow()`,
    which returns a naive value that cannot be compared with an aware one
    without raising.
    """
    return datetime.now(timezone.utc)


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    # The hash is the lookup key, so it is the primary key: there is no second
    # identifier worth carrying, and this guarantees one row per token.
    token_hash = Column(String(64), primary_key=True)

    # users.user_id — the UUID, not the autoincrementing row id. Sessions
    # outlive nothing, but pointing at the stable public identifier keeps this
    # table consistent with `conversations`, which is keyed the same way.
    user_id = Column(String(36), nullable=False, index=True)
    # Denormalised so an authenticated request can be attributed without a join
    # on every call. `user_id` remains the identifier anything is scoped by.
    username = Column(String(100), nullable=False)

    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    # Touched on use, so an idle session is visible as such. Deliberately not
    # used to extend the expiry: a sliding window would keep a stolen cookie
    # alive indefinitely as long as it was being used.
    last_seen_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)

    # For audit only — never for authorisation. A changed user agent is a
    # signal worth being able to see, not grounds to reject a valid token.
    user_agent = Column(String(255), nullable=True)

    __table_args__ = (Index("ix_auth_sessions_expires_at", "expires_at"),)

    def is_live(self, now: datetime | None = None) -> bool:
        """Not expired. The only question this row exists to answer."""
        moment = now or utcnow()
        expires = self.expires_at
        # SQLite hands back naive datetimes even for a timezone-aware column,
        # so an aware comparison would raise there while working on MySQL.
        if expires is not None and expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        return expires is not None and expires > moment

    def __repr__(self) -> str:
        return f"<AuthSession user={self.username!r} expires={self.expires_at!r}>"


def expiry_from_now(ttl_days: int) -> datetime:
    return utcnow() + timedelta(days=ttl_days)
