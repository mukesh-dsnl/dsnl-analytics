"""
Provider selection.

Two rules shape this module:

1. **Imports are lazy.** Only the chosen provider's module is imported, so a
   missing SDK package for a provider nobody uses can never break the app. The
   three SDKs are all in requirements.txt to make swapping providers a config
   change rather than an install, but nothing here assumes all three are
   present.

2. **Nothing raises at import time.** A missing key is a `ProviderNotConfigured`
   raised when a client is actually asked for — which the API turns into a 503
   naming the variable to set. The CDR dashboards must keep working with no AI
   configured at all.
"""

import logging

from app.ai.providers.base import LLMClient
from app.core.config import get_settings

logger = logging.getLogger(__name__)

# Provider -> the env var that enables it. Order is the auto-detect order.
PROVIDER_KEYS: dict[str, str] = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "gemini": "GOOGLE_API_KEY",
}


class ProviderNotConfigured(RuntimeError):
    """No usable provider: no key set, or a named provider without its key."""


def _detect(settings) -> str:
    """The first provider whose key is present, in PROVIDER_KEYS order."""
    for provider, env_var in PROVIDER_KEYS.items():
        if getattr(settings, env_var, None):
            return provider
    raise ProviderNotConfigured(
        "AI chat is not configured. Set one of "
        + ", ".join(PROVIDER_KEYS.values())
        + " (and optionally AI_PROVIDER to choose between them)."
    )


def client_class(provider: str) -> type[LLMClient]:
    """The adapter class for a provider, imported only when it is asked for.

    Imported here, not at module scope: an uninstalled SDK for an unused
    provider must not break the import of this module.
    """
    try:
        if provider == "anthropic":
            from app.ai.providers.anthropic_provider import AnthropicClient as Client
        elif provider == "openai":
            from app.ai.providers.openai_provider import OpenAIClient as Client
        else:
            from app.ai.providers.gemini_provider import GeminiClient as Client
    except ImportError as exc:
        raise ProviderNotConfigured(
            f"The {provider} SDK is not installed: {exc}. "
            f"Install it (see backend/requirements.txt) or set AI_PROVIDER to a "
            f"provider whose SDK is present."
        ) from exc
    return Client


def get_llm_client() -> LLMClient:
    """Construct the client for one answer.

    With a pool file (AI_POOL_FILE, default backend/ai_pool.json) this is a
    FailoverClient that rotates across the listed keys and models; without one,
    the single provider chosen by AI_PROVIDER / AI_MODEL, exactly as before.

    A pool file whose entries all lack their keys falls through to the single
    provider path, so an unconfigured backup list never blocks the chat.

    Raises ProviderNotConfigured when nothing usable is configured — no key set,
    AI_PROVIDER naming a provider with no key, a missing SDK, or an invalid
    pool file.
    """
    settings = get_settings()

    # Imported lazily for the same reason as the adapters: nothing here may
    # fail at import time.
    from app.ai.providers.failover import FailoverClient, load_pool

    pool = load_pool()
    if pool:
        for provider in {entry.provider for entry in pool}:
            client_class(provider)  # fail now, as a 503, if an SDK is missing
        return FailoverClient(
            pool,
            attempt_timeout=settings.AI_ATTEMPT_TIMEOUT_SECONDS,
            budget=settings.AI_FAILOVER_BUDGET_SECONDS,
        )

    provider = (settings.AI_PROVIDER or "").strip().lower() or _detect(settings)

    if provider not in PROVIDER_KEYS:
        raise ProviderNotConfigured(
            f"AI_PROVIDER={provider!r} is not a provider. "
            f"Choose one of: {', '.join(PROVIDER_KEYS)}."
        )

    env_var = PROVIDER_KEYS[provider]
    if not getattr(settings, env_var, None):
        raise ProviderNotConfigured(
            f"AI_PROVIDER is {provider!r} but {env_var} is not set."
        )

    client = client_class(provider)(model=settings.AI_MODEL, api_key=getattr(settings, env_var))
    logger.info(f"AI chat using provider={client.provider} model={client.model}")
    return client
