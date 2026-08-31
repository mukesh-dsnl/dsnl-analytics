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


def get_llm_client() -> LLMClient:
    """Construct the configured provider's client.

    Raises ProviderNotConfigured when no key is set, when AI_PROVIDER names a
    provider with no key, or when that provider's SDK isn't installed.
    """
    settings = get_settings()

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

    # Imported here, not at module scope: an uninstalled SDK for an unused
    # provider must not break the import of this module.
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

    client = Client(model=settings.AI_MODEL, api_key=getattr(settings, env_var))
    logger.info(f"AI chat using provider={client.provider} model={client.model}")
    return client
