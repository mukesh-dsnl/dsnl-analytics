"""
Gemini adapter, on the `google-genai` SDK.

Verified against google-genai 2.20.0. Three things about this SDK shaped the
code below and are worth stating, because none are guessable:

* **`parameters_json_schema`, not `parameters`.** `FunctionDeclaration` accepts
  both, but `parameters` coerces the dict into the SDK's own `Schema` type,
  which silently drops JSON Schema keywords it doesn't model (`format: date`
  among them). `parameters_json_schema` passes the schema through verbatim.
  Older SDKs have only `parameters`, so this falls back to it.

* **Thought signatures must be replayed.** Gemini 3.x returns an opaque
  `thought_signature` (96 bytes, observed) on the *part* carrying a function
  call, and rejects the whole request with

      400 INVALID_ARGUMENT — Function call is missing a thought_signature in
      functionCall parts

  if that turn is later sent back without it. So the signature is captured into
  `ToolCallRequest.provider_meta` on the way in and restored on the way out.
  This is also why the assistant turn is rebuilt with `types.Part(...)` rather
  than `Part.from_function_call`, which has no parameter for it. Nothing here
  interprets the bytes; they are carried, not read.

* **Call ids are incidental.** Gemini matches a function response to its call
  by *name*, not by id. `FunctionCall` does expose an `id`, and this model
  populates it, but an id is invented as a fallback so the neutral shape always
  has one. It never goes on the wire.

* **No error flag.** A function response is just a dict, so a failure has to be
  folded into the content ("ERROR: ..."). Without that the model reads a
  rejected query as a successful empty answer and reports it as fact.
"""

import logging
from typing import Any

from google import genai
from google.genai import types

from app.ai.providers.base import (
    LLMClient,
    LLMTurn,
    NeutralMessage,
    ToolCallRequest,
    ToolSpec,
)

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-3.5-flash-lite"

# True when the installed SDK supports raw JSON Schema pass-through.
_HAS_JSON_SCHEMA = "parameters_json_schema" in types.FunctionDeclaration.model_fields


class GeminiClient(LLMClient):
    provider = "gemini"

    def __init__(self, model: str | None = None, api_key: str | None = None):
        self.model = model or DEFAULT_MODEL
        # The SDK reads GOOGLE_API_KEY from the environment on its own, but the
        # key is passed explicitly so a value from .env (which the app loads
        # into Settings, not into os.environ) works the same way.
        self._client = genai.Client(api_key=api_key) if api_key else genai.Client()

    # ── Translation: neutral -> Gemini ─────────────────────────────────────

    @staticmethod
    def _declaration(spec: ToolSpec) -> types.FunctionDeclaration:
        field = "parameters_json_schema" if _HAS_JSON_SCHEMA else "parameters"
        return types.FunctionDeclaration(
            name=spec.name,
            description=spec.description,
            **{field: spec.input_schema},
        )

    @classmethod
    def _to_contents(cls, history: list[NeutralMessage]) -> list[types.Content]:
        """Neutral history -> Gemini `Content` turns.

        Gemini's roles are "user" and "model", and a tool result is a *user*
        turn carrying function-response parts — the same convention Anthropic
        uses, and the opposite of OpenAI's dedicated tool role.
        """
        contents: list[types.Content] = []

        for message in history:
            parts: list[types.Part] = []

            if message.tool_results:
                for result in message.tool_results:
                    # Errors ride in the content string; see the module docstring.
                    text = f"ERROR: {result.content}" if result.is_error else result.content
                    parts.append(
                        types.Part.from_function_response(
                            name=result.name, response={"result": text}
                        )
                    )
                contents.append(types.Content(role="user", parts=parts))
                continue

            if message.text:
                parts.append(types.Part.from_text(text=message.text))
            for call in message.tool_calls:
                # Built directly rather than via Part.from_function_call, which
                # takes no thought_signature — and without the signature the
                # API rejects the replayed call outright (see the docstring).
                parts.append(
                    types.Part(
                        function_call=types.FunctionCall(
                            name=call.name, args=call.input
                        ),
                        thought_signature=call.provider_meta.get("thought_signature"),
                    )
                )

            if not parts:
                continue

            contents.append(
                types.Content(
                    role="model" if message.role == "assistant" else "user",
                    parts=parts,
                )
            )

        return contents

    # ── Translation: Gemini -> neutral ─────────────────────────────────────

    @staticmethod
    def _from_response(response: Any) -> LLMTurn:
        candidates = getattr(response, "candidates", None) or []
        if not candidates:
            # A prompt blocked before generation has no candidate at all.
            feedback = getattr(response, "prompt_feedback", None)
            logger.warning(f"Gemini returned no candidates (feedback={feedback})")
            return LLMTurn(
                text="The model returned no response for that question.",
                stop_reason="end_turn",
            )

        content = getattr(candidates[0], "content", None)
        parts = getattr(content, "parts", None) or []

        texts: list[str] = []
        tool_calls: list[ToolCallRequest] = []

        for index, part in enumerate(parts):
            if getattr(part, "text", None):
                texts.append(part.text)
            call = getattr(part, "function_call", None)
            if call is not None and getattr(call, "name", None):
                # The signature belongs to the *part*, not the call, and must
                # be replayed verbatim when this turn is sent back.
                signature = getattr(part, "thought_signature", None)
                tool_calls.append(
                    ToolCallRequest(
                        id=getattr(call, "id", None) or f"call_{index}",
                        name=call.name,
                        input=dict(getattr(call, "args", None) or {}),
                        provider_meta=(
                            {"thought_signature": signature} if signature else {}
                        ),
                    )
                )

        usage = getattr(response, "usage_metadata", None)
        return LLMTurn(
            text="\n".join(texts).strip(),
            tool_calls=tool_calls,
            stop_reason="tool_use" if tool_calls else "end_turn",
            input_tokens=getattr(usage, "prompt_token_count", 0) or 0,
            # Thinking tokens are generated and billed like any other output,
            # and Gemini reports them separately from the candidate text — so
            # counting only candidates_token_count would understate the turn.
            output_tokens=(
                (getattr(usage, "candidates_token_count", 0) or 0)
                + (getattr(usage, "thoughts_token_count", 0) or 0)
            ),
        )

    # ── The one method ─────────────────────────────────────────────────────

    def send(
        self, system: str, history: list[NeutralMessage], tools: list[ToolSpec]
    ) -> LLMTurn:
        config = types.GenerateContentConfig(
            system_instruction=system,
            tools=[types.Tool(function_declarations=[self._declaration(t) for t in tools])],
        )
        response = self._client.models.generate_content(
            model=self.model,
            contents=self._to_contents(history),
            config=config,
        )
        return self._from_response(response)
