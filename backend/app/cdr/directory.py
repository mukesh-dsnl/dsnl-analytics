"""
Account and client names, from the master-list parquet files beside the lake:

    <share>/dump/accounts/accounts.parquet   accountid, accountname, …
    <share>/dump/clients/clients.parquet     clientid, accountid, clientname, …

Read with DuckDB, and only the id and name columns — the clients file also
holds passwords, phone numbers and e-mail addresses, none of which ever leave
it. The lists change rarely and are a few thousand rows, so each is read once
and kept until the file changes (its mtime), or for ten minutes when the
share cannot say.

A missing or unreadable file is not an error for the pages using it: they
fall back to showing ids, so `accounts()` and `clients()` return empty maps.
"""

import logging
import os
import threading
import time
from pathlib import Path
from typing import Optional

import duckdb

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_TTL_SECONDS = 600
_lock = threading.Lock()
_cache: dict[str, tuple[float, float, dict]] = {}  # key -> (mtime, loaded_at, data)


def _beside_lake(folder: str, filename: str) -> Path:
    return Path(get_settings().CDR_LAKE_PATH).parent / folder / filename


def accounts_path() -> Path:
    configured = get_settings().ACCOUNTS_PARQUET_PATH
    return Path(configured) if configured else _beside_lake("accounts", "accounts.parquet")


def clients_path() -> Path:
    configured = get_settings().CLIENTS_PARQUET_PATH
    return Path(configured) if configured else _beside_lake("clients", "clients.parquet")


_ACCOUNTS_SQL = """
    SELECT accountid AS id, TRIM(accountname) AS name
    FROM read_parquet(?)
    WHERE accountid IS NOT NULL AND accountname IS NOT NULL AND TRIM(accountname) <> ''
"""

_CLIENTS_SQL = """
    SELECT clientid AS id, accountid AS account_id, TRIM(clientname) AS name
    FROM read_parquet(?)
    WHERE clientid IS NOT NULL AND clientname IS NOT NULL AND TRIM(clientname) <> ''
"""


def _load(key: str, path: Path, sql: str) -> dict:
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        mtime = -1.0
    with _lock:
        cached = _cache.get(key)
        if cached and cached[0] == mtime and (mtime >= 0 or time.time() - cached[1] < _TTL_SECONDS):
            return cached[2]
    try:
        with duckdb.connect() as connection:
            rows = connection.execute(sql, [str(path)]).fetchall()
    except Exception as exc:  # a share that is down must not take the pages with it
        logger.warning("Couldn't read %s (%s); showing ids instead of names", path, exc)
        return cached[2] if cached else {}
    # Some names are entered with a leading "- " ("- NO DND - Spandana …"); drop it.
    data = {int(row[0]): (*row[1:-1], row[-1].lstrip(" -–")) for row in rows}
    with _lock:
        _cache[key] = (mtime, time.time(), data)
    return data


def accounts() -> dict[int, str]:
    """Account id → name."""
    return {account_id: values[0] for account_id, values in _load("accounts", accounts_path(), _ACCOUNTS_SQL).items()}


def clients() -> dict[int, str]:
    """Client id → name."""
    return {client_id: values[1] for client_id, values in _load("clients", clients_path(), _CLIENTS_SQL).items()}


def account_name(account_id: int) -> Optional[str]:
    return accounts().get(int(account_id))
