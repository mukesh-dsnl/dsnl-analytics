"""Failover contract: any error rotates to the next model, then the next key;
the shared pointer keeps later rounds and questions on whatever worked."""

import json
import os
import time

import pytest

from app.ai.providers import failover
from app.ai.providers.base import (
    LLMClient,
    LLMTurn,
    NeutralMessage,
    ToolCallRequest,
    ToolResult,
)
from app.ai.providers.failover import AllCandidatesFailed, FailoverClient, PoolEntry, _Pointer
from app.core.config import get_settings


class StatusError(Exception):
    """Stands in for an SDK error that carries an HTTP status."""

    def __init__(self, status, *, attr="status_code", headers=None, details=None):
        super().__init__(f"HTTP {status}")
        setattr(self, attr, status)
        self.response = type("R", (), {"headers": headers or {}})()
        self.details = details


class FakeClient(LLMClient):
    """Plays a script of outcomes: an exception to raise or a turn to return."""

    def __init__(self, provider, model, script):
        self.provider, self.model = provider, model
        self._script = list(script)
        self.calls: list[list[NeutralMessage]] = []

    def send(self, system, history, tools):
        self.calls.append(list(history))
        outcome = self._script.pop(0) if len(self._script) > 1 else self._script[0]
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


def turn(text="ok", tool_calls=None):
    return LLMTurn(
        text=text,
        tool_calls=tool_calls or [],
        stop_reason="tool_use" if tool_calls else "end_turn",
    )


POOL = [
    PoolEntry("key-a", "gemini", "secret-a", ("m1", "m2")),
    PoolEntry("key-b", "gemini", "secret-b", ("m1",)),
    PoolEntry("key-c", "anthropic", "secret-c", ("c1",)),
]


@pytest.fixture
def rig(monkeypatch):
    """Fake clients per (key, model), and a fresh rotation pointer per test."""
    clients: dict[tuple[str, str], FakeClient] = {}
    pointer = _Pointer()

    def script(entry, model, *outcomes):
        provider = next(e.provider for e in POOL if e.name == entry)
        clients[(entry, model)] = FakeClient(provider, model, outcomes)

    def client_for(entry, model, timeout):
        return clients[(entry.name, model)]

    monkeypatch.setattr(failover, "_client_for", client_for)

    def make(pool=POOL, budget=60.0):
        return FailoverClient(pool, attempt_timeout=5.0, budget=budget, pointer=pointer)

    return type("Rig", (), {"script": staticmethod(script), "make": staticmethod(make),
                            "clients": clients, "pointer": pointer})


def calls(rig, entry, model):
    client = rig.clients.get((entry, model))
    return len(client.calls) if client else 0


# ── Rotation order ─────────────────────────────────────────────────────────


def test_tries_each_model_on_a_key_before_the_next_key(rig):
    rig.script("key-a", "m1", TimeoutError())
    rig.script("key-a", "m2", StatusError(503))
    rig.script("key-b", "m1", turn("from b"))
    rig.script("key-c", "c1", turn("unused"))

    client = rig.make()
    result = client.send("sys", [NeutralMessage(role="user", text="q")], [])

    assert result.text == "from b"
    assert (calls(rig, "key-a", "m1"), calls(rig, "key-a", "m2"), calls(rig, "key-b", "m1")) == (1, 1, 1)
    assert calls(rig, "key-c", "c1") == 0
    # The response reports who actually answered.
    assert (client.provider, client.model) == ("gemini", "m1")


def test_any_error_rotates_including_a_rejected_key_or_request(rig):
    rig.script("key-a", "m1", StatusError(401))
    rig.script("key-a", "m2", StatusError(400))
    rig.script("key-b", "m1", turn("from b"))

    assert rig.make().send("sys", [], []).text == "from b"


def test_each_candidate_is_tried_at_most_once_per_round(rig):
    for entry, model in [("key-a", "m1"), ("key-a", "m2"), ("key-b", "m1"), ("key-c", "c1")]:
        rig.script(entry, model, StatusError(500))

    with pytest.raises(AllCandidatesFailed):
        rig.make().send("sys", [], [])
    assert all(len(c.calls) == 1 for c in rig.clients.values())


def test_every_candidate_failing_raises_with_a_summary(rig):
    rig.script("key-a", "m1", TimeoutError())
    rig.script("key-a", "m2", StatusError(500))
    rig.script("key-b", "m1", StatusError(429))
    rig.script("key-c", "c1", StatusError(529))

    with pytest.raises(AllCandidatesFailed) as raised:
        rig.make().send("sys", [], [])
    message = str(raised.value)
    assert "key-a/m1: TimeoutError" in message
    assert "key-c/c1: StatusError (529)" in message


def test_the_deadline_bounds_a_total_outage(rig, monkeypatch):
    now = [0.0]
    monkeypatch.setattr(failover.time, "monotonic", lambda: now[0])

    class SlowClient(FakeClient):
        def send(self, system, history, tools):
            self.calls.append(list(history))
            now[0] = 100.0  # this attempt used up the whole budget
            raise TimeoutError()

    rig.clients[("key-a", "m1")] = SlowClient("gemini", "m1", [None])
    rig.script("key-a", "m2", turn("too late"))

    with pytest.raises(AllCandidatesFailed, match="deadline"):
        rig.make(budget=10.0).send("sys", [], [])
    assert calls(rig, "key-a", "m2") == 0


# ── The shared pointer ─────────────────────────────────────────────────────


def test_rounds_after_a_rate_limit_start_on_the_new_candidate(rig):
    """A 12-requests-a-minute model runs out on round 3 of a long answer: round
    3 moves on, and rounds 4+ never touch the exhausted model again."""
    rig.script("key-a", "m1", turn("r1"), turn("r2"), StatusError(429), turn("never"))
    rig.script("key-a", "m2", turn("r3"), turn("r4"), turn("r5"))

    client = rig.make()
    texts = [client.send("sys", [], []).text for _ in range(5)]

    assert texts == ["r1", "r2", "r3", "r4", "r5"]
    assert calls(rig, "key-a", "m1") == 3
    assert (client.provider, client.model) == ("gemini", "m2")


def test_the_next_question_starts_where_the_last_one_ended(rig):
    rig.script("key-a", "m1", StatusError(429), turn("never"))
    rig.script("key-a", "m2", turn("first"), turn("second"))

    rig.make().send("sys", [], [])
    assert rig.make().send("sys", [], []).text == "second"
    assert calls(rig, "key-a", "m1") == 1


def test_rotation_wraps_round_to_the_first_key(rig):
    rig.script("key-c", "c1", StatusError(429))
    rig.script("key-a", "m1", turn("back to the start"))
    rig.pointer.set(POOL[2], "c1")  # the last candidate is current

    assert rig.make().send("sys", [], []).text == "back to the start"
    assert calls(rig, "key-c", "c1") == 1


def test_a_round_where_everything_fails_leaves_the_pointer_alone(rig):
    rig.script("key-a", "m2", StatusError(500), turn("recovered"))
    for entry, model in [("key-a", "m1"), ("key-b", "m1"), ("key-c", "c1")]:
        rig.script(entry, model, StatusError(500))
    rig.pointer.set(POOL[0], "m2")

    with pytest.raises(AllCandidatesFailed):
        rig.make().send("sys", [], [])
    assert rig.make().send("sys", [], []).text == "recovered"


def test_the_pointer_survives_the_current_candidate_being_removed(rig):
    rig.script("key-b", "m1", turn("from b"))
    rig.pointer.set(PoolEntry("gone", "gemini", "x", ("m9",)), "m9")

    assert rig.make(pool=[POOL[1]]).send("sys", [], []).text == "from b"


# ── Switching provider in the middle of an answer ──────────────────────────


def _tool_history(call_id="call-1"):
    call = ToolCallRequest(id=call_id, name="get_cdr_panel", input={"days": 7},
                           provider_meta={"thought_signature": b"sig"})
    return call, [
        NeutralMessage(role="user", text="minutes last week?"),
        NeutralMessage(role="assistant", tool_calls=[call]),
        NeutralMessage(role="user", tool_results=[ToolResult(call_id=call_id, name="get_cdr_panel", content='{"minutes": 42}')]),
    ]


def test_moving_to_another_provider_mid_answer_rewrites_tool_turns_as_text(rig):
    call, history = _tool_history()
    rig.script("key-a", "m1", turn("", tool_calls=[call]), StatusError(503))
    rig.script("key-a", "m2", StatusError(503))
    rig.script("key-b", "m1", StatusError(503))
    rig.script("key-c", "c1", turn("42 minutes"))

    client = rig.make()
    client.send("sys", history[:1], [])  # Gemini issues the tool call
    assert client.send("sys", history, []).text == "42 minutes"

    sent = rig.clients[("key-c", "c1")].calls[0]
    assert not any(m.tool_calls or m.tool_results for m in sent)
    assert "[Called tool `get_cdr_panel`" in sent[1].text
    assert '{"minutes": 42}' in sent[2].text


def test_staying_on_the_same_provider_keeps_tool_turns_intact(rig):
    call, history = _tool_history()
    rig.script("key-a", "m1", turn("", tool_calls=[call]), StatusError(503))
    rig.script("key-a", "m2", turn("same provider"))

    client = rig.make()
    client.send("sys", history[:1], [])
    client.send("sys", history, [])

    sent = rig.clients[("key-a", "m2")].calls[0]
    assert sent[1].tool_calls[0].provider_meta == {"thought_signature": b"sig"}


# ── Loading the pool ───────────────────────────────────────────────────────


@pytest.fixture
def pool_file(tmp_path, monkeypatch):
    path = tmp_path / "ai_pool.json"
    monkeypatch.setattr(get_settings(), "AI_POOL_FILE", str(path))
    failover._pool_cache.update(stamp=None, pool=[])

    def write(entries):
        path.write_text(json.dumps({"pool": entries}), encoding="utf-8")
        # A distinct mtime, so the change is picked up even within one tick.
        stamp = time.time() + len(path.read_text())
        os.utime(path, (stamp, stamp))

    return write


def test_pool_reads_keys_from_the_environment_and_skips_missing_ones(pool_file, monkeypatch):
    monkeypatch.setenv("TEST_POOL_KEY_A", "secret-a")
    monkeypatch.delenv("TEST_POOL_KEY_MISSING", raising=False)
    pool_file([
        {"name": "a", "provider": "gemini", "key_env": "TEST_POOL_KEY_A", "models": ["m1", "m2"]},
        {"name": "gone", "provider": "openai", "key_env": "TEST_POOL_KEY_MISSING", "models": ["x"]},
        {"name": "off", "provider": "gemini", "key_env": "TEST_POOL_KEY_A", "models": ["m"], "enabled": False},
    ])
    pool = failover.load_pool()
    assert [(e.name, e.api_key, e.models) for e in pool] == [("a", "secret-a", ("m1", "m2"))]


def test_pool_is_reread_when_the_file_changes(pool_file, monkeypatch):
    monkeypatch.setenv("TEST_POOL_KEY_A", "secret-a")
    pool_file([{"name": "a", "provider": "gemini", "key_env": "TEST_POOL_KEY_A", "models": ["m1"]}])
    assert failover.load_pool()[0].models == ("m1",)
    pool_file([{"name": "a", "provider": "gemini", "key_env": "TEST_POOL_KEY_A", "models": ["m1", "m-new"]}])
    assert failover.load_pool()[0].models == ("m1", "m-new")


def test_an_invalid_pool_is_a_configuration_error(pool_file):
    from app.ai.providers.factory import ProviderNotConfigured

    pool_file([{"name": "x", "provider": "nobody", "models": ["m"]}])
    with pytest.raises(ProviderNotConfigured, match="unknown provider"):
        failover.load_pool()


def test_factory_returns_the_failover_client_when_a_pool_is_configured(pool_file, monkeypatch):
    from app.ai.providers.factory import get_llm_client

    monkeypatch.setenv("TEST_POOL_KEY_A", "secret-a")
    pool_file([{"name": "a", "provider": "gemini", "key_env": "TEST_POOL_KEY_A", "models": ["m1"]}])
    assert isinstance(get_llm_client(), FailoverClient)


def test_no_pool_file_keeps_the_single_provider_path(monkeypatch):
    from app.ai.providers.factory import get_llm_client

    settings = get_settings()
    monkeypatch.setattr(settings, "AI_POOL_FILE", "")
    monkeypatch.setattr(settings, "AI_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "GOOGLE_API_KEY", "test-key")
    client = get_llm_client()
    assert not isinstance(client, FailoverClient)
    assert client.provider == "gemini"


# ── Adapters: one bounded attempt, no SDK retries ──────────────────────────


def test_adapters_take_a_timeout_and_disable_sdk_retries():
    from app.ai.providers.anthropic_provider import AnthropicClient
    from app.ai.providers.gemini_provider import GeminiClient
    from app.ai.providers.openai_provider import OpenAIClient

    anthropic_client = AnthropicClient(model="claude-sonnet-5-5", api_key="test", timeout=7.0)._client
    assert (anthropic_client.max_retries, anthropic_client.timeout) == (0, 7.0)

    openai_client = OpenAIClient(model="gpt-4.1-mini", api_key="test", timeout=7.0)._client
    assert (openai_client.max_retries, openai_client.timeout) == (0, 7.0)

    options = GeminiClient(model="m", api_key="test", timeout=7.0)._client._api_client._http_options
    assert options.timeout == 7000
    assert options.retry_options.attempts == 1
