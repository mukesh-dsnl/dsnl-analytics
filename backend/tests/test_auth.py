"""
Tests for the authentication boundary.

Three things are worth proving, and they are different things:

1. **A password gets you a session.** Credentials are checked once, at login,
   and what comes back is a cookie — not a claim the client then repeats.

2. **Every endpoint requires one.** Not "the login page appears", which is only
   a UI convention, but that the API itself refuses an unauthenticated caller.
   `test_every_api_route_refuses_an_anonymous_caller` walks the live route
   table rather than a hand-written list, so a route added later without a
   guard fails here instead of shipping open.

3. **Users cannot reach each other's data.** Authentication says who you are;
   this says what you may touch. It is the half that actually closes the hole,
   and the half most easily left out — a login screen in front of an API that
   still answers `?username=someone_else` protects nothing.
"""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base
from app.core.config import get_settings
from app.core.database import Base, get_db
from app.main import app
from app.models.conversation import Conversation
from app.models.session import AuthSession, hash_token, utcnow
from app.models.user import User

PASSWORD = "correct horse"


@pytest.fixture
def session_factory():
    """A throwaway SQLite database wired into the app's get_db dependency.

    StaticPool with one shared connection: an in-memory SQLite database lives
    inside its connection, so the default pool would hand the request and the
    assertions two different empty databases.
    """
    engine = create_engine(
        "sqlite://",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    def override():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override
    try:
        yield factory
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


@pytest.fixture
def db(session_factory):
    db = session_factory()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def client(session_factory):
    return TestClient(app)


def make_user(db, username="alice", user_id=None) -> User:
    user = User(
        username=username,
        password_hash=PASSWORD,  # plain text, by design — see app/api/auth.py
        user_id=user_id or f"uuid-{username}",
    )
    db.add(user)
    db.commit()
    return user


def sign_in(client, username="alice", password=PASSWORD):
    return client.post("/api/auth/login", json={"username": username, "password": password})


# ── Getting a session ──────────────────────────────────────────────────────


def test_a_correct_password_returns_a_session_cookie(client, db):
    make_user(db)
    response = sign_in(client)

    assert response.status_code == 200
    assert response.json()["username"] == "alice"

    cookie = get_settings().SESSION_COOKIE_NAME
    assert cookie in response.cookies
    # The row is what authenticates later requests, so it has to exist.
    assert db.query(AuthSession).count() == 1


def test_the_cookie_value_is_not_what_is_stored(client, db):
    """A dump of auth_sessions must not hand over usable sessions."""
    make_user(db)
    response = sign_in(client)
    token = response.cookies[get_settings().SESSION_COOKIE_NAME]

    stored = db.query(AuthSession).one()
    assert stored.token_hash != token
    assert stored.token_hash == hash_token(token)


def test_the_session_cookie_is_not_readable_by_script(client, db):
    make_user(db)
    response = sign_in(client)
    header = response.headers["set-cookie"].lower()
    assert "httponly" in header
    assert "samesite=lax" in header


def test_a_wrong_password_is_refused(client, db):
    make_user(db)
    response = sign_in(client, password="wrong")
    assert response.status_code == 401
    assert db.query(AuthSession).count() == 0


def test_an_unknown_user_is_refused_identically(client, db):
    """Same status and same message as a wrong password.

    Differing here would let anyone enumerate which accounts exist.
    """
    make_user(db)
    unknown = sign_in(client, username="nobody")
    wrong = sign_in(client, password="wrong")

    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json()["detail"] == wrong.json()["detail"]


def test_the_session_expires_after_the_configured_days(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "SESSION_TTL_DAYS", 3)
    make_user(db)
    sign_in(client)

    stored = db.query(AuthSession).one()
    lifetime = stored.expires_at.replace(tzinfo=utcnow().tzinfo) - stored.created_at.replace(
        tzinfo=utcnow().tzinfo
    )
    assert timedelta(days=2, hours=23) < lifetime < timedelta(days=3, hours=1)


# ── Using and losing it ────────────────────────────────────────────────────


def test_me_names_the_signed_in_user(client, db):
    make_user(db)
    sign_in(client)
    response = client.get("/api/auth/me")
    assert response.status_code == 200
    assert response.json()["username"] == "alice"


def test_me_refuses_an_anonymous_caller(client, db):
    assert client.get("/api/auth/me").status_code == 401


def test_logout_destroys_the_session(client, db):
    make_user(db)
    sign_in(client)
    assert client.post("/api/auth/logout").status_code == 200

    assert db.query(AuthSession).count() == 0
    # And the cookie no longer opens anything, even if it were replayed.
    assert client.get("/api/auth/me").status_code == 401


def test_logout_without_a_session_is_not_an_error(client, db):
    """"Make sure I am signed out" is satisfied by an already-signed-out caller,
    and a 401 would strand a client holding a stale cookie."""
    assert client.post("/api/auth/logout").status_code == 200


def test_an_expired_session_is_refused_and_swept(client, db):
    make_user(db)
    sign_in(client)

    stored = db.query(AuthSession).one()
    stored.expires_at = utcnow() - timedelta(seconds=1)
    db.commit()

    assert client.get("/api/auth/me").status_code == 401
    # Read by the only person holding the token, so this is the natural moment
    # to collect it — no sweeper job needed.
    assert db.query(AuthSession).count() == 0


def test_a_forged_cookie_is_refused(client, db):
    make_user(db)
    client.cookies.set(get_settings().SESSION_COOKIE_NAME, "not-a-real-token")
    assert client.get("/api/auth/me").status_code == 401


def test_a_session_whose_user_was_deleted_is_refused(client, db):
    user = make_user(db)
    sign_in(client)
    db.delete(user)
    db.commit()

    assert client.get("/api/auth/me").status_code == 401


# ── Every endpoint ─────────────────────────────────────────────────────────

# Open by design. Everything else must refuse an anonymous caller.
PUBLIC = {"/api/auth/login", "/api/auth/logout", "/health"}


def _api_routes():
    from fastapi.routing import APIRoute

    for route in app.routes:
        if isinstance(route, APIRoute) and route.path not in PUBLIC:
            for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
                yield method, route.path


def test_every_api_route_refuses_an_anonymous_caller(client, db):
    """Walks the live route table, not a list written by hand.

    A route added later without a guard fails here rather than shipping open,
    which is the only version of this test worth having.
    """
    unguarded = []
    for method, path in _api_routes():
        url = path.replace("{conversation_id}", "anything")
        response = client.request(method, url, json={})
        if response.status_code != 401:
            unguarded.append(f"{method} {path} -> {response.status_code}")

    assert not unguarded, "routes reachable without signing in: " + "; ".join(unguarded)


def test_there_is_at_least_one_route_under_test():
    """Guards the guard: an empty route table would make the test above pass
    while proving nothing."""
    assert len(list(_api_routes())) > 20


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_the_api_documentation_requires_a_session(client, db, path):
    """The schema lists every route, request shape and field name in the system.

    FastAPI serves these unauthenticated by default, which would leave that map
    readable by anyone who can reach the port — a hole of a different kind than
    an open endpoint, but a hole.
    """
    assert client.get(path).status_code == 401


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_the_api_documentation_opens_once_signed_in(client, db, path):
    """The control. Without it the test above would pass if /docs 401'd for
    everyone, which would be a broken page rather than a protected one."""
    make_user(db)
    sign_in(client)
    assert client.get(path).status_code == 200


def test_the_schema_marks_guarded_routes_as_requiring_the_cookie(client, db):
    """The padlock on /docs is generated from this, so it is worth asserting
    rather than eyeballing."""
    make_user(db)
    sign_in(client)
    schema = client.get("/openapi.json").json()

    assert "session" in schema["components"]["securitySchemes"]
    assert schema["components"]["securitySchemes"]["session"]["in"] == "cookie"

    guarded = schema["paths"]["/api/ai/conversations"]["get"]
    assert any("session" in requirement for requirement in guarded.get("security", []))

    # And the open one is not marked, or the padlock would mean nothing.
    assert "security" not in schema["paths"]["/api/auth/login"]["post"]


# ── Ownership ──────────────────────────────────────────────────────────────


def own_conversation(db, user: User, conversation_id: str, title="hers") -> Conversation:
    conversation = Conversation(
        id=conversation_id, user_id=user.user_id, username=user.username, title=title
    )
    db.add(conversation)
    db.commit()
    return conversation


def test_the_list_shows_only_your_own_threads(client, db):
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    own_conversation(db, alice, "a1", "alice thread")
    own_conversation(db, bob, "b1", "bob thread")

    sign_in(client, "alice")
    rows = client.get("/api/ai/conversations").json()

    assert [r["id"] for r in rows] == ["a1"]


def test_the_list_cannot_be_asked_for_someone_elses(client, db):
    """The old endpoint took a `username` query parameter and filtered on it,
    so naming someone else returned their threads. Passing it now is ignored."""
    alice = make_user(db, "alice")
    bob = make_user(db, "bob")
    own_conversation(db, alice, "a1")
    own_conversation(db, bob, "b1")

    sign_in(client, "alice")
    rows = client.get("/api/ai/conversations?username=bob").json()

    assert [r["id"] for r in rows] == ["a1"]


def test_reading_another_users_thread_is_a_404(client, db):
    """404 rather than 403 — a 403 would confirm the thread exists."""
    make_user(db, "alice")
    bob = make_user(db, "bob")
    own_conversation(db, bob, "b1")

    sign_in(client, "alice")
    response = client.get("/api/ai/conversations/b1")

    assert response.status_code == 404
    assert response.json()["detail"] == "No such conversation."


def test_a_missing_thread_is_indistinguishable_from_someone_elses(client, db):
    make_user(db, "alice")
    bob = make_user(db, "bob")
    own_conversation(db, bob, "b1")

    sign_in(client, "alice")
    theirs = client.get("/api/ai/conversations/b1")
    nothing = client.get("/api/ai/conversations/does-not-exist")

    assert theirs.status_code == nothing.status_code == 404
    assert theirs.json() == nothing.json()


def test_renaming_another_users_thread_is_a_404(client, db):
    make_user(db, "alice")
    bob = make_user(db, "bob")
    own_conversation(db, bob, "b1", title="bob's title")

    sign_in(client, "alice")
    response = client.patch("/api/ai/conversations/b1", json={"title": "mine now"})

    assert response.status_code == 404
    assert db.get(Conversation, "b1").title == "bob's title"


def test_deleting_another_users_thread_is_a_404_and_leaves_it(client, db):
    make_user(db, "alice")
    bob = make_user(db, "bob")
    own_conversation(db, bob, "b1")

    sign_in(client, "alice")
    response = client.delete("/api/ai/conversations/b1")

    assert response.status_code == 404
    # Reporting idempotent success would claim to have removed something the
    # caller cannot see and which is still there.
    assert db.get(Conversation, "b1") is not None


def test_stopping_another_users_answer_is_a_404(client, db):
    """Stopping is a write. Being able to halt someone else's work would be a
    denial of service with a friendly button on it."""
    make_user(db, "alice")
    bob = make_user(db, "bob")
    own_conversation(db, bob, "b1")

    sign_in(client, "alice")
    assert client.post("/api/ai/conversations/b1/stop").status_code == 404


def test_stopping_your_own_thread_with_nothing_running_is_fine(client, db):
    """Idempotent: the intent — "do not continue" — is already satisfied."""
    alice = make_user(db, "alice")
    own_conversation(db, alice, "a1")

    sign_in(client, "alice")
    response = client.post("/api/ai/conversations/a1/stop")

    assert response.status_code == 200
    assert response.json() == {"stopped": 0}


def test_your_own_thread_is_readable(client, db):
    """The control. Without it the tests above would pass if everything 404'd."""
    alice = make_user(db, "alice")
    own_conversation(db, alice, "a1")

    sign_in(client, "alice")
    response = client.get("/api/ai/conversations/a1")

    assert response.status_code == 200
    assert response.json()["id"] == "a1"
