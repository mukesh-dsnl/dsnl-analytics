"""
The tool-calling loop.

Provider-agnostic by construction: it speaks only the neutral shapes from
`providers.base`, and every vendor difference is absorbed by an adapter. That
is what makes the conversation history the API round-trips to the client
portable — a chat can start on Gemini and continue on Anthropic without the
stored history meaning anything different.

Two invariants that are easy to break and expensive to debug:

* **All of one turn's tool results go into a single NeutralMessage.** Anthropic
  requires them grouped in one user message; splitting them across turns
  silently degrades parallel tool use rather than erroring. The adapters that
  need them split (OpenAI) split them on the way out.

* **The loop is bounded.** A model that keeps refining instead of answering
  costs real money and real latency against a network share, so the rounds are
  capped and exhausting them is a returned answer, not an exception.

An unknown tool name, or a tool that raises, is fed back to the model as an
error result rather than propagated. Within the loop those are recoverable; as
exceptions they would end the conversation over something the next round would
have fixed.
"""

import logging
import traceback
from typing import Any, Callable

from app.ai.providers.base import LLMClient, NeutralMessage, ToolResult
from app.ai.providers.factory import get_llm_client
from app.ai.schema_prompt import SYSTEM_PROMPT
from app.ai.tools.ad_hoc_sql import RUN_QUERY_TOOL, run_cdr_query
from app.ai.tools.structured import GET_PANEL_TOOL, get_cdr_panel
from app.core.config import get_settings

logger = logging.getLogger(__name__)

TOOLS = [GET_PANEL_TOOL, RUN_QUERY_TOOL]

DISPATCH: dict[str, Callable[..., tuple[str, bool]]] = {
    "get_cdr_panel": get_cdr_panel,
    "run_cdr_query": run_cdr_query,
}

BUDGET_EXCEEDED = (
    "I couldn't settle this within the query budget. Try narrowing the date range "
    "or asking one thing at a time."
)


def _run_tool(name: str, arguments: dict[str, Any]) -> tuple[str, bool]:
    """Execute one tool call, converting any failure into a result the model can read."""
    handler = DISPATCH.get(name)
    if handler is None:
        return (f"There is no tool called '{name}'. Available: {', '.join(DISPATCH)}.", True)

    try:
        return handler(**arguments)
    except TypeError as exc:
        # Wrong or missing arguments for the tool's signature — the model's
        # mistake, and one it can correct from this message.
        return (f"Those arguments don't fit {name}: {exc}", True)
    except Exception as exc:  # noqa: BLE001 — the loop must survive any tool fault
        logger.error(f"Tool {name} raised: {exc}\n{traceback.format_exc()}")
        return (f"The {name} tool failed unexpectedly: {exc}", True)


def answer(
    history: list[NeutralMessage] | None = None,
    question: str = "",
    llm: LLMClient | None = None,
) -> dict[str, Any]:
    """Answer one question, running tools as the model asks for them.

    `llm` is injectable so the loop can be tested without a network or a key;
    in production it is left None and resolved from configuration.

    Returns {answer, provider, model, queries} — `queries` being every tool call
    made, which the API surfaces so an answer can be traced back to the query
    that produced it.
    """
    settings = get_settings()
    client = llm or get_llm_client()

    conversation: list[NeutralMessage] = [
        *(history or []),
        NeutralMessage(role="user", text=question),
    ]
    queries_run: list[dict[str, Any]] = []

    for round_number in range(settings.AI_MAX_TOOL_ROUNDS):
        turn = client.send(SYSTEM_PROMPT, conversation, TOOLS)

        if turn.stop_reason != "tool_use" or not turn.tool_calls:
            return {
                "answer": turn.text,
                "provider": client.provider,
                "model": client.model,
                "queries": queries_run,
            }

        conversation.append(
            NeutralMessage(role="assistant", text=turn.text, tool_calls=turn.tool_calls)
        )

        results: list[ToolResult] = []
        for call in turn.tool_calls:
            logger.info(
                f"AI round {round_number + 1}/{settings.AI_MAX_TOOL_ROUNDS}: {call.name}"
            )
            content, is_error = _run_tool(call.name, call.input)
            queries_run.append({"tool": call.name, "input": call.input, "error": is_error})
            results.append(
                ToolResult(
                    call_id=call.id, name=call.name, content=content, is_error=is_error
                )
            )

        # One message carrying every result from this turn — see the docstring.
        conversation.append(NeutralMessage(role="user", tool_results=results))

    logger.warning(
        f"AI loop exhausted {settings.AI_MAX_TOOL_ROUNDS} rounds without an answer; "
        f"{len(queries_run)} tool calls made."
    )
    return {
        "answer": BUDGET_EXCEEDED,
        "provider": client.provider,
        "model": client.model,
        "queries": queries_run,
    }
