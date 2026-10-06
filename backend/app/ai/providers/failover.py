"""
Rotation across several API keys and models, behind the one `LLMClient` seam.

The pool is described in `ai_pool.json` (see AI_POOL_FILE): an ordered list of
keys, each with its own ordered list of models. Keys themselves stay in the
environment / .env — the JSON only names the variable that holds each one.

The rule is deliberately simple: **one shared pointer to the current
candidate.** Every request starts there. Any error — timeout, rate limit,
outage, rejected key — moves the pointer to the next model on the same key,
then on to the next key, wrapping around after the last. A success leaves the
pointer where it is, so the following rounds and questions keep using the
candidate that works.

That suits per-minute rate limits: when a model runs out of its requests
partway through a many-round answer, that round moves on, and every round after
it starts on the new candidate instead of hitting the exhausted one again. The
rotation only comes back round to it after the others have had their turn.

Two things keep the rotation fast, and one keeps it safe:

* **Every attempt has a hard timeout and no SDK-side retries**, so a hanging or
  failing candidate gives way at once instead of being retried internally.
* **Each round tries each candidate at most once.** If all of them fail, the
  round fails with every reason listed, rather than looping.
* **An answer that changes provider mid-way** has its earlier tool rounds
  rewritten as text, because each provider attaches its own state to tool calls.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.ai.providers.base import LLMClient, LLMTurn, NeutralMessage, ToolSpec
from app.core.config import get_settings

logger = logging.getLogger(__name__)

# backend/ — relative paths in settings resolve here, not against the cwd.
BACKEND_DIR = Path(__file__).resolve().parents[3]


class AllCandidatesFailed(RuntimeError):
    """Every key and model in the pool failed (or the deadline passed)."""


@dataclass(frozen=True)
class PoolEntry:
    """One API key and the models to try on it, in order."""

    name: str
    provider: str
    api_key: str
    models: tuple[str, ...]


Candidate = tuple[PoolEntry, str]


def _reason(exc: BaseException) -> str:
    """A short, key-free description of a failure, for logs and the error."""
    status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    return f"{type(exc).__name__} ({status})" if isinstance(status, int) else type(exc).__name__


# ── The rotation pointer ────────────────────────────────────────────────


class _Pointer:
    """Which candidate requests start from, shared by every request and thread.

    Stored by name rather than index so it survives the pool file being edited:
    if the current candidate is removed, rotation restarts from the top.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._current: tuple[str, str] | None = None

    def order(self, candidates: list[Candidate]) -> list[Candidate]:
        """The candidates, starting from the current one and wrapping round."""
        with self._lock:
            current = self._current
        start = next(
            (i for i, (entry, model) in enumerate(candidates) if (entry.name, model) == current),
            0,
        )
        return candidates[start:] + candidates[:start]

    def set(self, entry: PoolEntry, model: str) -> None:
        with self._lock:
            self._current = (entry.name, model)

    def reset(self) -> None:
        with self._lock:
            self._current = None


POINTER = _Pointer()


# ── Pool loading ────────────────────────────────────────────────────────


def _resolve(path_setting: str) -> Path:
    path = Path(path_setting)
    return path if path.is_absolute() else BACKEND_DIR / path


def _secret(name: str) -> str | None:
    """A key by variable name: process environment first, then backend/.env,
    then a Settings field of that name (so GOOGLE_API_KEY etc. keep working)."""
    import os

    from dotenv import dotenv_values

    value = os.environ.get(name) or dotenv_values(BACKEND_DIR / ".env").get(name)
    return value or getattr(get_settings(), name, None) or None


_pool_cache: dict[str, Any] = {"stamp": None, "pool": []}
_pool_lock = threading.Lock()


def load_pool() -> list[PoolEntry]:
    """The usable entries of the pool file, re-read only when the file changes.

    Returns [] when no pool file is configured or present, which means the
    single-provider configuration (AI_PROVIDER / AI_MODEL) is used instead.
    Entries whose key variable is unset are skipped, so the file can list
    backups that are not configured on every machine.
    """
    from app.ai.providers.factory import PROVIDER_KEYS, ProviderNotConfigured

    setting = get_settings().AI_POOL_FILE
    if not setting:
        return []
    path = _resolve(setting)
    try:
        stamp = (str(path), path.stat().st_mtime_ns)
    except FileNotFoundError:
        return []

    with _pool_lock:
        if _pool_cache["stamp"] == stamp:
            return _pool_cache["pool"]

        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise ProviderNotConfigured(f"{path.name} could not be read: {exc}") from exc

        pool: list[PoolEntry] = []
        seen: set[str] = set()
        for index, item in enumerate(raw.get("pool", [])):
            name = str(item.get("name") or f"entry-{index + 1}")
            provider = str(item.get("provider", "")).strip().lower()
            models = tuple(str(m) for m in item.get("models", []) if str(m).strip())
            if item.get("enabled") is False:
                continue
            if provider not in PROVIDER_KEYS:
                raise ProviderNotConfigured(f"{path.name}: {name!r} has unknown provider {provider!r}.")
            if not models:
                raise ProviderNotConfigured(f"{path.name}: {name!r} lists no models.")
            if name in seen:
                raise ProviderNotConfigured(f"{path.name}: the name {name!r} is used twice.")
            seen.add(name)

            key_env = str(item.get("key_env") or PROVIDER_KEYS[provider])
            api_key = _secret(key_env)
            if not api_key:
                logger.info(f"AI pool: skipping {name!r} — {key_env} is not set")
                continue
            pool.append(PoolEntry(name=name, provider=provider, api_key=api_key, models=models))

        _pool_cache.update(stamp=stamp, pool=pool)
        logger.info(
            "AI pool loaded: "
            + ", ".join(f"{e.name}[{'/'.join(e.models)}]" for e in pool)
        )
        return pool


# ── Client construction ─────────────────────────────────────────────────

_clients: dict[tuple[str, str, float], LLMClient] = {}
_clients_lock = threading.Lock()


def _client_for(entry: PoolEntry, model: str, timeout: float) -> LLMClient:
    """One SDK client per (key, model), reused across requests — the SDK
    clients hold connection pools and are safe to share between threads."""
    from app.ai.providers.factory import client_class

    cache_key = (entry.name, model, timeout)
    with _clients_lock:
        client = _clients.get(cache_key)
        if client is None:
            client = client_class(entry.provider)(model=model, api_key=entry.api_key, timeout=timeout)
            _clients[cache_key] = client
        return client


# ── Switching provider mid-answer ───────────────────────────────────────


def _flatten_tool_turns(history: list[NeutralMessage]) -> list[NeutralMessage]:
    """Tool calls and results rewritten as plain text.

    Used only when one answer moves to a *different provider* part-way through
    its tool rounds. Each provider attaches its own state to a tool call —
    Gemini rejects a replayed call without its `thought_signature`, which a call
    made by Claude never has. As text, the earlier rounds are readable by any
    model, so the new one can carry on from what was already found.
    """
    flattened: list[NeutralMessage] = []
    for message in history:
        if message.tool_calls:
            lines = [message.text] if message.text else []
            lines += [
                f"[Called tool `{call.name}` with input {json.dumps(call.input, default=str)}]"
                for call in message.tool_calls
            ]
            flattened.append(NeutralMessage(role="assistant", text="\n".join(lines)))
        elif message.tool_results:
            text = "\n\n".join(
                f"[{'Error from' if r.is_error else 'Result of'} tool `{r.name}`]\n{r.content}"
                for r in message.tool_results
            )
            flattened.append(NeutralMessage(role="user", text=text))
        else:
            flattened.append(message)
    return flattened


# ── The client ──────────────────────────────────────────────────────────


class FailoverClient(LLMClient):
    """Tries pool candidates from the shared pointer onward until one answers.

    One instance serves one answer (the factory builds it per request); the
    pointer it moves is shared, so the next answer benefits from what this one
    found out.
    """

    def __init__(
        self,
        pool: list[PoolEntry],
        *,
        attempt_timeout: float,
        budget: float,
        pointer: _Pointer = POINTER,
    ):
        if not pool:
            raise ValueError("FailoverClient needs at least one pool entry")
        self._candidates: list[Candidate] = [(entry, model) for entry in pool for model in entry.models]
        self._attempt_timeout = attempt_timeout
        self._budget = budget
        self._pointer = pointer
        # Which provider issued each tool call in this answer, by call id.
        self._call_origin: dict[str, str] = {}
        # Reported in the API response; updated to whoever actually answered.
        first_entry, first_model = pointer.order(self._candidates)[0]
        self.provider, self.model = first_entry.provider, first_model

    def _history_for(self, provider: str, history: list[NeutralMessage]) -> list[NeutralMessage]:
        foreign = any(
            self._call_origin.get(call.id, provider) != provider
            for message in history
            for call in message.tool_calls
        )
        return _flatten_tool_turns(history) if foreign else history

    def send(self, system: str, history: list[NeutralMessage], tools: list[ToolSpec]) -> LLMTurn:
        deadline = time.monotonic() + self._budget
        failures: list[str] = []
        last_error: BaseException | None = None

        for entry, model in self._pointer.order(self._candidates):
            if time.monotonic() >= deadline:
                failures.append("deadline reached")
                break

            label = f"{entry.name}/{model}"
            try:
                client = _client_for(entry, model, self._attempt_timeout)
                turn = client.send(system, self._history_for(entry.provider, history), tools)
            except Exception as exc:  # noqa: BLE001 — any failure rotates
                last_error = exc
                failures.append(f"{label}: {_reason(exc)}")
                logger.warning(f"AI failover: {label} failed ({_reason(exc)}); rotating to the next candidate")
                continue

            # Point every later round and question at the one that worked.
            self._pointer.set(entry, model)
            if failures:
                logger.info(f"AI failover: {label} answered after {len(failures)} failed attempt(s)")
            self.provider, self.model = entry.provider, model
            for call in turn.tool_calls:
                self._call_origin[call.id] = entry.provider
            return turn

        raise AllCandidatesFailed(
            f"No AI provider could answer ({'; '.join(failures) or 'no candidates'})."
        ) from last_error
