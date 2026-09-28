"""
Provider adapters for the AI chat module.

Only `base` and `factory` are imported here. The three concrete adapters are
imported lazily by the factory so that an SDK missing for a provider nobody
uses cannot break the application.
"""

from app.ai.providers.base import (
    LLMClient,
    LLMTurn,
    NeutralMessage,
    ToolCallRequest,
    ToolResult,
    ToolSpec,
)
from app.ai.providers.factory import ProviderNotConfigured, get_llm_client

__all__ = [
    "LLMClient",
    "LLMTurn",
    "NeutralMessage",
    "ToolCallRequest",
    "ToolResult",
    "ToolSpec",
    "ProviderNotConfigured",
    "get_llm_client",
]
