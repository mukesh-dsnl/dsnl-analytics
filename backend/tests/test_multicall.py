"""Production lookup contract: explicit, bounded, read-only source queries."""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 - register application-owned tables
from app.core.database import Base, get_db
from app.main import app
from app.models.user import User
from app.multicall import service


def test_unconfigured_source_never_falls_back_to_application_database(monkeypatch):
    monkeypatch.setattr(
        service, "get_settings", lambda: SimpleNamespace(MULTICALL_DATABASE_URL=None),
    )
    service.source_engine.cache_clear()
    with pytest.raises(service.SourceNotConfigured):
        service.source_engine()


@pytest.fixture
def source(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    with engine.begin() as con:
        con.execute(text("""
            CREATE TABLE MultiCallRegistration (
                RegNum INTEGER PRIMARY KEY, Phone TEXT, EmailID TEXT, Name TEXT,
                UpdatedDateTime TEXT, SocialNetworkFlag INTEGER,
                MultiCallRegType INTEGER, LowercaseEmailID TEXT
            )
        """))
        con.execute(text("""
            CREATE TABLE MultiCallProfile (
                RegNum INTEGER, ProfileRefNum INTEGER, ProfileName TEXT,
                ProfilePhone TEXT, ProfileEmailID TEXT, ConfRefNum INTEGER,
                ChairpersonPin TEXT, ParticipantPin TEXT, Status INTEGER,
                UpdatedDateTime TEXT, AccountType INTEGER, ISDAllowStatus INTEGER,
                ProfileSize INTEGER, AckStatus INTEGER, ModifiedTimeEpoch INTEGER,
                AddedDateTime TEXT, ProfileDefault INTEGER
            )
        """))
        con.execute(text("""
            INSERT INTO MultiCallRegistration VALUES
            (16, '111', 'Alice@Example.com', 'Alice', '2026-09-04 09:00:00', 1, 1, 'alice@example.com'),
            (24, '222', 'bob@example.com', 'Bob', '2026-09-06 09:00:00', 3, 1, 'bob@example.com'),
            (17, '111', 'alice@example.com', 'Alice duplicate', '2026-09-08 09:00:00', 1, 1, 'alice@example.com')
        """))
        con.execute(text("""
            INSERT INTO MultiCallProfile VALUES
            (16, 1, 'Work', '333', 'Work@Example.com', 99, '1234', '4567', 1,
             '2026-09-04 09:00:00', 1, 1, 4, 1, 1788512400, '2026-09-04 09:00:00', 1),
            (16, 2, 'Family', '444', 'family@example.com', 98, '7654', '9876', 0,
             '2026-09-05 09:00:00', 2, 0, 2, 0, 1788598800, '2026-09-05 09:00:00', 0)
        """))
    monkeypatch.setattr(service, "source_engine", lambda: engine)
    yield engine
    engine.dispose()


def _reg_nums(**criteria):
    return [row["reg_num"] for row in service.search_registrations(criteria)["rows"]]


def test_search_matches_registration_or_profile_contact_and_exact_cpin(source):
    assert _reg_nums(reg_nums=["16"]) == [16]
    assert _reg_nums(phones=["111"]) == [16]
    assert _reg_nums(phones=["333"]) == [16]
    assert _reg_nums(emails=["ALICE@EXAMPLE.COM"]) == [16]
    assert _reg_nums(emails=["work@example.com"]) == [16]
    assert _reg_nums(cpins=["1234"]) == [16]
    assert _reg_nums(phones=["11"]) == []
    assert _reg_nums(cpins=["123"]) == []
    assert service.search_registrations({}) == {"rows": [], "truncated": False}


def test_search_value_lists_use_in_and_any_field_may_match(source):
    assert _reg_nums(reg_nums=["16", "24", "999"]) == [24, 16]
    assert _reg_nums(phones=["222", "444"]) == [24, 16]
    assert _reg_nums(reg_nums=["24"], cpins=["7654"]) == [24, 16]


def test_search_reports_what_matched_and_profile_counts(source):
    rows = service.search_registrations({"reg_nums": ["24"], "phones": ["444"], "cpins": ["1234"]})["rows"]
    alice = next(row for row in rows if row["reg_num"] == 16)
    bob = next(row for row in rows if row["reg_num"] == 24)
    assert alice["matched_on"] == ["phones", "cpins"]
    assert sorted(alice["matched_profiles"]) == ["1", "2"]
    assert (alice["profile_count"], alice["active_profile_count"]) == (2, 1)
    assert bob["matched_on"] == ["reg_nums"]
    assert bob["matched_profiles"] == []
    assert (bob["profile_count"], bob["active_profile_count"]) == (0, 0)


def test_only_main_reg_nums_divisible_by_eight_are_shown(source):
    with source.begin() as con:
        con.execute(text("""
            INSERT INTO MultiCallProfile (RegNum, ProfileRefNum, ProfileName, ChairpersonPin, Status)
            VALUES (17, 1, 'Duplicate', '1234', 1)
        """))
    # Reg 17 shares Alice's phone, email and CPIN but is a duplicate.
    assert _reg_nums(reg_nums=["17"]) == []
    assert _reg_nums(phones=["111"]) == [16]
    assert _reg_nums(emails=["alice@example.com"]) == [16]
    assert _reg_nums(cpins=["1234"]) == [16]
    assert service.registration_with_profiles("17", 1) is None


def test_registration_and_profiles_arrive_together_with_full_pins(source):
    result = service.registration_with_profiles("16", 1)
    assert result["registration"]["name"] == "Alice"
    assert [item["profile_ref_num"] for item in result["profiles"]] == [2, 1]
    assert result["profiles"][1]["chair_pin"] == "1234"
    assert result["profiles"][1]["participant_pin"] == "4567"
    assert not result["has_more"]
    assert service.registration_with_profiles("24", 1)["profiles"] == []
    assert service.registration_with_profiles("999", 1) is None


def test_profiles_load_in_bounded_pages_only_when_requested(source):
    with source.begin() as con:
        con.execute(text("""
            INSERT INTO MultiCallProfile (
                RegNum, ProfileRefNum, ProfileName, Status, AccountType, AddedDateTime
            ) VALUES (:reg_num, :profile_ref_num, :name, 1, 1, '2026-09-07 09:00:00')
        """), [
            {"reg_num": 16, "profile_ref_num": number, "name": f"Extra {number}"}
            for number in range(3, 52)
        ])
    first = service.registration_with_profiles("16", 1)
    assert len(first["profiles"]) == 50
    assert first["has_more"]
    second = service.registration_with_profiles("16", 2)
    assert len(second["profiles"]) == 1
    assert not second["has_more"]


def test_each_action_uses_one_select_and_no_source_schema_changes(source):
    statements: list[str] = []

    def capture(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    event.listen(source, "before_cursor_execute", capture)
    try:
        service.search_registrations({"cpins": ["1234"]})
        service.registration_with_profiles("16", 1)
    finally:
        event.remove(source, "before_cursor_execute", capture)
    assert len(statements) == 2
    assert all(statement.lstrip().upper().startswith("SELECT ") for statement in statements)


def test_lookup_api_requires_session_and_does_not_query_source_for_anonymous_user(source):
    database = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=database)
    factory = sessionmaker(bind=database)

    def override_db():
        with factory() as db:
            yield db

    statements: list[str] = []

    def capture(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    app.dependency_overrides[get_db] = override_db
    event.listen(source, "before_cursor_execute", capture)
    try:
        client = TestClient(app)
        payload = {"phones": ["333"]}
        assert client.post("/api/multicall/search", json=payload).status_code == 401
        assert statements == []
        with factory() as db:
            db.add(User(username="reader", password_hash="test-only", user_id="reader-id"))
            db.commit()
        assert client.post(
            "/api/auth/login", json={"username": "reader", "password": "test-only"},
        ).status_code == 200
        response = client.post("/api/multicall/search", json=payload)
        assert response.status_code == 200
        assert [row["reg_num"] for row in response.json()["rows"]] == [16]
        assert len(statements) == 1
        response = client.get("/api/multicall/registrations/16")
        assert response.status_code == 200
        assert len(response.json()["profiles"]) == 2
        assert len(statements) == 2
        assert client.post("/api/multicall/search", json={"phones": [" ", ""]}).status_code == 422
        assert client.post(
            "/api/multicall/search", json={"cpins": [str(n) for n in range(101)]},
        ).status_code == 422
        assert len(statements) == 2
    finally:
        event.remove(source, "before_cursor_execute", capture)
        app.dependency_overrides.pop(get_db, None)
        database.dispose()
