"""
The neutral shapes every provider adapter translates to and from.

Three vendors express the same conversation three different ways: Anthropic
carries tool results as content blocks inside a user message, OpenAI as one
`role="tool"` message per result, Gemini as function-response parts with no
call id at all. The orchestrator should not have to know that, so this module
defines one vocabulary and each adapter translates into its own wire format on
every call.

Adapters are **stateless**. They never accumulate history of their own: each
`send` converts the whole neutral history afresh. That is what makes a provider
swappable mid-conversation and what keeps the history the API round-trips to
the client provider-independent.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Literal


@dataclass
class ToolSpec:
    """One tool offered to the model. `input_schema` is plain JSON Schema."""

    name: str
    description: str
    input_schema: dict[str, Any]


@dataclass
class ToolCallRequest:
    """The model asking for one tool to be run.

    `id` is what pairs the result back to the call. Anthropic and OpenAI both
    supply one; Gemini usually does too, and the adapter invents one when it
    doesn't, since Gemini matches results to calls by function name anyway.

    `provider_meta` is opaque state the issuing adapter must hand back verbatim
    on the next request. It exists for exactly one reason: Gemini 3.x rejects a
    replayed function call whose `thought_signature` is missing, so that
    signature has to survive the round trip through neutral shapes. Nothing
    outside the adapter that set it may read or interpret it, and it is not
    serialised into the history the API returns — it is meaningful only within
    a single `answer()` call.
    """

    id: str
    name: str
    input: dict[str, Any]
    provider_meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolResult:
    """What running a tool produced, as text the model reads.

    `is_error` is a signal to the model, not an exception: a rejected SQL
    statement or an out-of-range date comes back through here so the model can
    correct itself, rather than surfacing as a 500 to the caller.
    """

    call_id: str
    name: str
    content: str
    is_error: bool = False


@dataclass
class NeutralMessage:
    """One turn. Either text, or tool calls, or tool results — never a mix of
    the last two, since a turn is by definition one side speaking.
    """

    role: Literal["user", "assistant"]
    text: str | None = None
    tool_calls: list[ToolCallRequest] = field(default_factory=list)
    tool_results: list[ToolResult] = field(default_factory=list)


@dataclass
class LLMTurn:
    """One response from the model.

    `stop_reason` is narrowed to the only distinction the loop acts on: either
    the model wants tools run, or it is finished. Every other vendor-specific
    stop reason (length, safety, content filter) collapses to "end_turn" — the
    loop's job is to stop asking, and the text it has is what the user gets.
    """

    text: str
    tool_calls: list[ToolCallRequest] = field(default_factory=list)
    stop_reason: Literal["tool_use", "end_turn"] = "end_turn"


class LLMClient(ABC):
    """One method, because one method is all the orchestrator needs.

    Implementations set `provider` and `model` so the API response can report
    which one actually answered.
    """

    provider: str = ""
    model: str = ""

    @abstractmethod
    def send(
        self,
        system: str,
        history: list[NeutralMessage],
        tools: list[ToolSpec],
    ) -> LLMTurn:
        """Send the whole conversation and return the model's next turn."""
        raise NotImplementedError
