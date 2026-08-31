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
from time import perf_counter
from typing import Any, Callable, Iterator

from app.ai.providers.base import LLMClient, NeutralMessage, ToolResult
from app.ai.providers.factory import get_llm_client
from app.ai.schema_prompt import SYSTEM_PROMPT
from app.ai.tools.ad_hoc_sql import RUN_QUERY_TOOL, run_cdr_query
from app.ai.tools.metrics import QUERY_METRICS_TOOL, query_metrics
from app.ai.tools.structured import GET_PANEL_TOOL, get_cdr_panel
from app.core.config import get_settings

logger = logging.getLogger(__name__)

# Order matters: the model reads these as a list, and the one that answers most
# questions is offered first.
TOOLS = [QUERY_METRICS_TOOL, GET_PANEL_TOOL, RUN_QUERY_TOOL]

DISPATCH: dict[str, Callable[..., tuple[str, bool]]] = {
    "query_metrics": query_metrics,
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


def answer_events(
    history: list[NeutralMessage] | None = None,
    question: str = "",
    llm: LLMClient | None = None,
) -> Iterator[dict[str, Any]]:
    """The loop, as a stream of events. `answer()` below is this, drained.

    A question can take several rounds and tens of seconds against a network
    share, and a blocking call gives the caller nothing to show for it — so the
    loop reports what it is doing as it does it. Every event carries the round
    it belongs to, and the timings are measured here rather than inferred by
    the client, because only this side knows when a tool actually started.

    Event types:

        round_start   {round}                          the model is deciding
        round_thinking {round, seconds}                it decided
        tool_start    {round, index, tool, input}      a tool is running
        tool_end      {round, index, ok, seconds}      it finished
        done          {answer, provider, model, queries}

    `done` is always the last event, including when the budget runs out — a
    consumer can rely on seeing exactly one.
    """
    settings = get_settings()
    client = llm or get_llm_client()

    conversation: list[NeutralMessage] = [
        *(history or []),
        NeutralMessage(role="user", text=question),
    ]
    queries_run: list[dict[str, Any]] = []

    for round_number in range(settings.AI_MAX_TOOL_ROUNDS):
        round_index = round_number + 1

        yield {"type": "round_start", "round": round_index}

        started = perf_counter()
        turn = client.send(SYSTEM_PROMPT, conversation, TOOLS)
        yield {
            "type": "round_thinking",
            "round": round_index,
            "seconds": round(perf_counter() - started, 2),
        }

        if turn.stop_reason != "tool_use" or not turn.tool_calls:
            yield {
                "type": "done",
                "answer": turn.text,
                "provider": client.provider,
                "model": client.model,
                "queries": queries_run,
            }
            return

        conversation.append(
            NeutralMessage(role="assistant", text=turn.text, tool_calls=turn.tool_calls)
        )

        results: list[ToolResult] = []
        for index, call in enumerate(turn.tool_calls):
            logger.info(
                f"AI round {round_index}/{settings.AI_MAX_TOOL_ROUNDS}: {call.name}"
            )
            yield {
                "type": "tool_start",
                "round": round_index,
                "index": index,
                "tool": call.name,
                "input": call.input,
            }

            started = perf_counter()
            content, is_error = _run_tool(call.name, call.input)
            elapsed = round(perf_counter() - started, 2)

            queries_run.append({"tool": call.name, "input": call.input, "error": is_error})
            results.append(
                ToolResult(
                    call_id=call.id, name=call.name, content=content, is_error=is_error
                )
            )

            yield {
                "type": "tool_end",
                "round": round_index,
                "index": index,
                "tool": call.name,
                "ok": not is_error,
                "seconds": elapsed,
            }

        # One message carrying every result from this turn — see the docstring.
        conversation.append(NeutralMessage(role="user", tool_results=results))

    logger.warning(
        f"AI loop exhausted {settings.AI_MAX_TOOL_ROUNDS} rounds without an answer; "
        f"{len(queries_run)} tool calls made."
    )
    yield {
        "type": "done",
        "answer": BUDGET_EXCEEDED,
        "provider": client.provider,
        "model": client.model,
        "queries": queries_run,
    }


def answer(
    history: list[NeutralMessage] | None = None,
    question: str = "",
    llm: LLMClient | None = None,
) -> dict[str, Any]:
    """Answer one question, running tools as the model asks for them.

    The non-streaming form: drains `answer_events` and returns its `done`
    payload. Both endpoints therefore run the identical loop, so the streaming
    one cannot drift from the one the tests cover.

    `llm` is injectable so the loop can be tested without a network or a key;
    in production it is left None and resolved from configuration.

    Returns {answer, provider, model, queries} — `queries` being every tool call
    made, which the API surfaces so an answer can be traced back to the query
    that produced it.
    """
    final: dict[str, Any] = {}
    for event in answer_events(history=history, question=question, llm=llm):
        if event["type"] == "done":
            final = {k: v for k, v in event.items() if k != "type"}
    return final
