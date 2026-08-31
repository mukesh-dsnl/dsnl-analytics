"""
Anthropic adapter, on the `anthropic` SDK.

Verified against anthropic 1.2.0. Three model-family rules are encoded here
because getting them wrong is an API rejection, not a degradation:

* `thinking={"type": "adaptive"}` with **no** `budget_tokens` — current
  Opus/Sonnet models reject the budget form.
* **No assistant prefill.** The history is sent as-is; the last message is
  never a partial assistant turn.
* **Tool results are never split.** All results for one assistant turn go in a
  single `role="user"` message as a list of `tool_result` blocks. Splitting
  them across messages silently degrades parallel tool use.

The system prompt is sent as a cached block: it is ~4k tokens of schema that is
byte-identical on every round of the tool loop, which is exactly the shape
prompt caching is for.
"""

import logging
from typing import Any

import anthropic

from app.ai.providers.base import (
    LLMClient,
    LLMTurn,
    NeutralMessage,
    ToolCallRequest,
    ToolSpec,
)

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "claude-sonnet-4-5"
MAX_TOKENS = 4096


class AnthropicClient(LLMClient):
    provider = "anthropic"

    def __init__(self, model: str | None = None, api_key: str | None = None):
        self.model = model or DEFAULT_MODEL
        self._client = (
            anthropic.Anthropic(api_key=api_key) if api_key else anthropic.Anthropic()
        )

    # ── Translation: neutral -> Anthropic ──────────────────────────────────

    @staticmethod
    def _to_messages(history: list[NeutralMessage]) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = []

        for message in history:
            if message.tool_results:
                # All of one turn's results in one user message — see docstring.
                messages.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": result.call_id,
                                "content": result.content,
                                "is_error": result.is_error,
                            }
                            for result in message.tool_results
                        ],
                    }
                )
                continue

            blocks: list[dict[str, Any]] = []
            if message.text:
                blocks.append({"type": "text", "text": message.text})
            for call in message.tool_calls:
                blocks.append(
                    {
                        "type": "tool_use",
                        "id": call.id,
                        "name": call.name,
                        "input": call.input,
                    }
                )

            if not blocks:
                continue
            messages.append({"role": message.role, "content": blocks})

        return messages

    # ── Translation: Anthropic -> neutral ──────────────────────────────────

    @staticmethod
    def _from_response(response: Any) -> LLMTurn:
        texts: list[str] = []
        tool_calls: list[ToolCallRequest] = []

        for block in response.content:
            block_type = getattr(block, "type", None)
            if block_type == "text":
                texts.append(block.text)
            elif block_type == "tool_use":
                tool_calls.append(
                    ToolCallRequest(id=block.id, name=block.name, input=dict(block.input))
                )
            # thinking blocks are deliberately dropped: they are the model's
            # own reasoning, not part of the answer or of the tool protocol.

        return LLMTurn(
            text="\n".join(texts).strip(),
            tool_calls=tool_calls,
            # Anything that isn't a tool request ends the loop — "max_tokens"
            # and "stop_sequence" both mean stop asking and use what we have.
            stop_reason="tool_use" if tool_calls else "end_turn",
        )

    # ── The one method ─────────────────────────────────────────────────────

    def send(
        self, system: str, history: list[NeutralMessage], tools: list[ToolSpec]
    ) -> LLMTurn:
        response = self._client.messages.create(
            model=self.model,
            max_tokens=MAX_TOKENS,
            thinking={"type": "adaptive"},
            system=[
                {
                    "type": "text",
                    "text": system,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            tools=[
                {
                    "name": tool.name,
                    "description": tool.description,
                    "input_schema": tool.input_schema,
                }
                for tool in tools
            ],
            messages=self._to_messages(history),
        )
        return self._from_response(response)
