"""
OpenAI adapter, Chat Completions tool calling.

Verified against openai 3.6.0: `chat.completions.create` takes `model`,
`messages`, `tools` and `tool_choice`; the response message carries `.content`
and `.tool_calls`, each call with `.id` and `.function.{name, arguments}`.

Two shape differences from the other two providers, both handled below:

* **Arguments are a JSON string**, not a dict — `json.loads` on the way in,
  `json.dumps` on the way out. A model occasionally emits malformed JSON here,
  so the parse is guarded: an unparseable call becomes an empty input, the tool
  rejects it, and the model gets a chance to correct itself. That is strictly
  better than a 500.

* **One `role="tool"` message per result**, not one message carrying all of
  them. This is the exact opposite of Anthropic's rule, which is why the
  orchestrator groups results into a single neutral message and lets each
  adapter split or not as its own format requires.
"""

import json
import logging
from typing import Any

from openai import OpenAI

from app.ai.providers.base import (
    LLMClient,
    LLMTurn,
    NeutralMessage,
    ToolCallRequest,
    ToolSpec,
)

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gpt-4.1-mini"


class OpenAIClient(LLMClient):
    provider = "openai"

    def __init__(self, model: str | None = None, api_key: str | None = None):
        self.model = model or DEFAULT_MODEL
        self._client = OpenAI(api_key=api_key) if api_key else OpenAI()

    # ── Translation: neutral -> OpenAI ─────────────────────────────────────

    @staticmethod
    def _to_messages(system: str, history: list[NeutralMessage]) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = [{"role": "system", "content": system}]

        for message in history:
            if message.tool_results:
                # One message per result — see the module docstring.
                for result in message.tool_results:
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": result.call_id,
                            # No is_error field in this format; the prefix is
                            # what tells the model the call failed.
                            "content": (
                                f"ERROR: {result.content}" if result.is_error else result.content
                            ),
                        }
                    )
                continue

            if message.tool_calls:
                messages.append(
                    {
                        "role": "assistant",
                        "content": message.text or None,
                        "tool_calls": [
                            {
                                "id": call.id,
                                "type": "function",
                                "function": {
                                    "name": call.name,
                                    "arguments": json.dumps(call.input),
                                },
                            }
                            for call in message.tool_calls
                        ],
                    }
                )
                continue

            if message.text:
                messages.append({"role": message.role, "content": message.text})

        return messages

    # ── Translation: OpenAI -> neutral ─────────────────────────────────────

    @staticmethod
    def _parse_arguments(raw: str | None, call_id: str) -> dict[str, Any]:
        """Tool arguments arrive as a JSON string, and are not always valid.

        A malformed call is handed on as an empty input rather than raised: the
        tool then rejects it with a message the model can act on, which keeps a
        recoverable mistake inside the loop.
        """
        if not raw:
            return {}
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning(f"OpenAI tool call {call_id} had unparseable arguments: {raw[:200]}")
            return {}
        return parsed if isinstance(parsed, dict) else {}

    @classmethod
    def _from_response(cls, response: Any) -> LLMTurn:
        message = response.choices[0].message
        raw_calls = getattr(message, "tool_calls", None) or []

        tool_calls = [
            ToolCallRequest(
                id=call.id,
                name=call.function.name,
                input=cls._parse_arguments(call.function.arguments, call.id),
            )
            for call in raw_calls
            # Only function tools carry a .function; anything else isn't ours.
            if getattr(call, "function", None) is not None
        ]

        return LLMTurn(
            text=(message.content or "").strip(),
            tool_calls=tool_calls,
            stop_reason="tool_use" if tool_calls else "end_turn",
        )

    # ── The one method ─────────────────────────────────────────────────────

    def send(
        self, system: str, history: list[NeutralMessage], tools: list[ToolSpec]
    ) -> LLMTurn:
        response = self._client.chat.completions.create(
            model=self.model,
            messages=self._to_messages(system, history),
            tools=[
                {
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.input_schema,
                    },
                }
                for tool in tools
            ],
        )
        return self._from_response(response)
