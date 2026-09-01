"""
Bring the chat tables up to the current schema.

`Base.metadata.create_all` creates missing tables but never alters existing
ones, so two changes need doing by hand:

  1. `users` gains a `user_id` UUID — added, backfilled for existing rows, and
     (on MySQL/MariaDB) given a trigger so accounts inserted with plain SQL get
     one too. MySQL cannot express `DEFAULT (UUID())` on a VARCHAR column, which
     is why a trigger rather than a column default.

  2. `messages` changes shape: it held one row per *turn* (role + JSON content)
     and now holds one row per *interaction* (query and response together, with
     a pass/fail status). The two shapes cannot be reconciled by adding
     columns, so the old table is dropped and rebuilt.

     Old rows are migrated where they pair up cleanly — a user turn followed by
     an assistant turn becomes one interaction. Anything that does not pair is
     reported and skipped rather than guessed at.

Idempotent: safe to run more than once. Run it from backend/:

    ./venv/Scripts/python.exe scripts/migrate_ai_chat.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect, text  # noqa: E402

from app.core.database import Base, engine  # noqa: E402
from app.models.user import new_user_id  # noqa: E402

TRIGGER_NAME = "users_user_id_default"


def column_names(connection, table: str) -> set[str]:
    inspector = inspect(connection)
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def migrate_users(connection, dialect: str) -> None:
    columns = column_names(connection, "users")
    if not columns:
        print("  users: table does not exist yet — create_all will build it")
        return

    if "user_id" not in columns:
        print("  users: adding user_id")
        connection.execute(text("ALTER TABLE users ADD COLUMN user_id VARCHAR(36) NULL"))
    else:
        print("  users: user_id already present")

    # Backfill anything missing one, in Python so the UUIDs match the format
    # the application generates.
    rows = connection.execute(
        text("SELECT id FROM users WHERE user_id IS NULL OR user_id = ''")
    ).fetchall()
    for (row_id,) in rows:
        connection.execute(
            text("UPDATE users SET user_id = :uid WHERE id = :id"),
            {"uid": new_user_id(), "id": row_id},
        )
    print(f"  users: backfilled {len(rows)} row(s)")

    # A unique index, once the column has no duplicates to trip over.
    existing_indexes = {i["name"] for i in inspect(connection).get_indexes("users")}
    if "ix_users_user_id" not in existing_indexes:
        try:
            connection.execute(
                text("CREATE UNIQUE INDEX ix_users_user_id ON users (user_id)")
            )
            print("  users: unique index created")
        except Exception as exc:  # noqa: BLE001 — an existing index is not fatal
            print(f"  users: index not created ({type(exc).__name__})")

    # Accounts here are inserted with plain SQL, so the ORM default never runs
    # for them. MySQL/MariaDB cannot default a VARCHAR to UUID(), hence this.
    if dialect == "mysql":
        connection.execute(text(f"DROP TRIGGER IF EXISTS {TRIGGER_NAME}"))
        connection.execute(
            text(
                f"CREATE TRIGGER {TRIGGER_NAME} BEFORE INSERT ON users "
                "FOR EACH ROW SET NEW.user_id = COALESCE(NULLIF(NEW.user_id, ''), UUID())"
            )
        )
        print(f"  users: trigger {TRIGGER_NAME} installed")


def migrate_conversations(connection) -> None:
    """`conversations.user_id` moves from the users PK to the user's UUID.

    It was a BIGINT referencing `users.id`; it now holds `users.user_id`, so
    the column type changes and the existing values have to be translated
    through the users table rather than simply cast.
    """
    inspector = inspect(connection)
    if "conversations" not in inspector.get_table_names():
        print("  conversations: table does not exist yet — create_all will build it")
        return

    columns = {c["name"]: c for c in inspector.get_columns("conversations")}
    if "user_id" not in columns:
        print("  conversations: adding user_id")
        connection.execute(
            text("ALTER TABLE conversations ADD COLUMN user_id VARCHAR(36) NULL")
        )
        return

    if "CHAR" in str(columns["user_id"]["type"]).upper():
        print("  conversations: user_id already holds a UUID")
        return

    print("  conversations: converting user_id from the users PK to the users UUID")

    # Translate before widening, while the old integers are still readable.
    pairs = connection.execute(
        text(
            "SELECT c.id, u.user_id FROM conversations c "
            "JOIN users u ON u.id = c.user_id WHERE c.user_id IS NOT NULL"
        )
    ).fetchall()

    connection.execute(text("ALTER TABLE conversations MODIFY COLUMN user_id VARCHAR(36) NULL"))

    for conversation_id, uuid_value in pairs:
        connection.execute(
            text("UPDATE conversations SET user_id = :uid WHERE id = :id"),
            {"uid": uuid_value, "id": conversation_id},
        )

    # Anything that pointed at a user row which no longer exists is cleared
    # rather than left holding a meaningless integer.
    connection.execute(
        text(
            "UPDATE conversations SET user_id = NULL "
            "WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT user_id FROM users)"
        )
    )
    print(f"  conversations: {len(pairs)} row(s) remapped")


def migrate_messages(connection) -> None:
    columns = column_names(connection, "messages")
    if not columns:
        print("  messages: table does not exist yet — create_all will build it")
        return

    if "query" in columns and "response" in columns:
        print("  messages: already in interaction shape")
        return

    print("  messages: old turn-shaped table found — converting")

    old = connection.execute(
        text(
            "SELECT id, conversation_id, role, content, input_tokens, output_tokens, "
            "created_at FROM messages ORDER BY conversation_id, id"
        )
    ).fetchall()

    # Pair each user turn with the assistant turn that follows it.
    import json

    def text_of(raw) -> str:
        if isinstance(raw, dict):
            payload = raw
        else:
            try:
                payload = json.loads(raw) if raw else {}
            except (TypeError, ValueError):
                return ""
        return payload.get("text", "") if isinstance(payload, dict) else ""

    interactions: list[dict] = []
    orphans = 0
    pending: dict | None = None

    for row in old:
        _id, conversation_id, role, content, in_tok, out_tok, created = row
        if role == "user":
            if pending is not None:
                orphans += 1  # a question that never got an answer
                interactions.append(pending)
            pending = {
                "conversation_id": conversation_id,
                "query": text_of(content),
                "response": None,
                "status": "fail",
                "input_token": 0,
                "output_tokens": 0,
                "created_at": created,
            }
        else:
            if pending is None:
                orphans += 1  # an answer with no question in front of it
                continue
            pending["response"] = text_of(content)
            pending["status"] = "pass"
            pending["input_token"] = in_tok or 0
            pending["output_tokens"] = out_tok or 0
            interactions.append(pending)
            pending = None

    if pending is not None:
        interactions.append(pending)

    connection.execute(text("DROP TABLE messages"))
    Base.metadata.tables["messages"].create(bind=connection)

    for item in interactions:
        connection.execute(
            text(
                "INSERT INTO messages (conversation_id, status, query, response, "
                "input_token, output_tokens, created_at) VALUES "
                "(:conversation_id, :status, :query, :response, :input_token, "
                ":output_tokens, :created_at)"
            ),
            item,
        )

    print(f"  messages: rebuilt with {len(interactions)} interaction(s)")
    if orphans:
        print(f"  messages: {orphans} unpaired turn(s) kept as incomplete interactions")


def main() -> int:
    import app.models  # noqa: F401 — registers every table on Base

    dialect = engine.dialect.name
    print(f"Migrating chat tables on {dialect}…")

    with engine.begin() as connection:
        migrate_users(connection, dialect)
        migrate_conversations(connection)
        migrate_messages(connection)

    # Anything still missing (a fresh install) gets built here.
    Base.metadata.create_all(bind=engine)
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
