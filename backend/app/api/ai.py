"""
AI chat API — natural-language questions over the CDR/CODR lake.

    POST /api/ai/chat        ask a question, get a text answer

There is no server-side session. The client sends back the `history` it was
given, which keeps the endpoint stateless and lets the same conversation be
answered by any worker. The history is round-tripped opaquely: its shape is the
neutral message format from app/ai/providers/base.py, not any one vendor's,
so a conversation survives a change of provider.

Failure modes are kept distinct on purpose:

    503  no provider configured — names the environment variable to set
    502  the provider or the loop failed — never carries a traceback

The dashboards do not depend on any of this. With no key configured every other
route behaves exactly as before and only this one returns 503.
"""

import json
import logging
from typing import Iterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.ai import orchestrator
from app.ai.providers.base import NeutralMessage, ToolCallRequest, ToolResult
from app.ai.providers.factory import ProviderNotConfigured, get_llm_client

logger = logging.getLogger(__name__)
router = APIRouter()


class ChatRequest(BaseModel):
    """A question, plus whatever history the client was handed last time."""

    question: str = Field(..., min_length=1, max_length=4000)
    # Opaque to the client: it stores what it got and sends it back. Typed as
    # plain dicts so a malformed entry is dropped below rather than 422-ing a
    # request whose question is perfectly answerable without it.
    history: list[dict] = Field(default_factory=list)


class ChatResponse(BaseModel):
    answer: str
    provider: str = ""
    model: str = ""
    # Every tool call made, in order — what the answer was actually built from.
    queries: list[dict] = Field(default_factory=list)
    # The conversation so far, to send back with the next question.
    history: list[dict] = Field(default_factory=list)


def _to_neutral(raw: list[dict]) -> list[NeutralMessage]:
    """Rebuild neutral messages from the client's copy.

    Anything malformed is skipped rather than rejected: a damaged history entry
    costs the model some context, while a 422 costs the user their question.
    """
    messages: list[NeutralMessage] = []

    for entry in raw:
        if not isinstance(entry, dict):
            continue
        role = entry.get("role")
        if role not in ("user", "assistant"):
            continue
        try:
            messages.append(
                NeutralMessage(
                    role=role,
                    text=entry.get("text"),
                    tool_calls=[
                        ToolCallRequest(id=c["id"], name=c["name"], input=c.get("input") or {})
                        for c in entry.get("tool_calls") or []
                    ],
                    tool_results=[
                        ToolResult(
                            call_id=r["call_id"],
                            name=r["name"],
                            content=r.get("content", ""),
                            is_error=bool(r.get("is_error")),
                        )
                        for r in entry.get("tool_results") or []
                    ],
                )
            )
        except (KeyError, TypeError) as exc:
            logger.warning(f"Dropping malformed history entry: {exc}")

    return messages


def _to_json(messages: list[NeutralMessage]) -> list[dict]:
    """Neutral messages back to the plain dicts the client stores."""
    return [
        {
            "role": message.role,
            "text": message.text,
            "tool_calls": [
                {"id": c.id, "name": c.name, "input": c.input} for c in message.tool_calls
            ],
            "tool_results": [
                {
                    "call_id": r.call_id,
                    "name": r.name,
                    "content": r.content,
                    "is_error": r.is_error,
                }
                for r in message.tool_results
            ],
        }
        for message in messages
    ]


@router.post("/ai/chat", response_model=ChatResponse)
def chat(body: ChatRequest) -> ChatResponse:
    """Answer one question about the CDR/CODR data.

    The model may call tools while working; every call it made comes back in
    `queries`, so an answer can be traced to the query behind it. An empty
    `queries` array on a substantive answer means the model declined to look —
    which is the correct behaviour for a question this data can't answer.
    """
    history = _to_neutral(body.history)

    try:
        result = orchestrator.answer(history=history, question=body.question)
    except ProviderNotConfigured as exc:
        # Configuration, not failure: the message names the variable to set.
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:  # noqa: BLE001 — nothing internal may reach the client
        logger.exception("AI chat failed")
        raise HTTPException(
            status_code=502,
            detail=f"The AI provider could not answer that request: {type(exc).__name__}.",
        )

    return ChatResponse(
        answer=result.get("answer", ""),
        provider=result.get("provider", ""),
        model=result.get("model", ""),
        queries=result.get("queries", []),
        history=_to_json(
            [
                *history,
                NeutralMessage(role="user", text=body.question),
                NeutralMessage(role="assistant", text=result.get("answer", "")),
            ]
        ),
    )


@router.post("/ai/chat/stream")
def chat_stream(body: ChatRequest) -> StreamingResponse:
    """The same answer, reported as it is worked out.

    Server-sent events, because a question can take several rounds and tens of
    seconds against a network share, and a blocking POST leaves the client with
    nothing to show for that time but a spinner. Each event says what the model
    is doing and how long the last step took, so the wait is legible rather
    than merely long.

    POST rather than GET (so EventSource can't be used, and the client reads
    the body itself): the question and the whole prior conversation go up with
    the request, which does not belong in a URL.

    The provider is resolved *before* the response begins. Once the first byte
    is out the status code is fixed, so an unconfigured provider has to fail as
    a normal 503 here rather than as an error event nobody checks for.
    """
    try:
        client = get_llm_client()
    except ProviderNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    history = _to_neutral(body.history)

    def events() -> Iterator[str]:
        answer_text = ""
        try:
            for event in orchestrator.answer_events(
                history=history, question=body.question, llm=client
            ):
                if event["type"] == "done":
                    answer_text = event.get("answer", "")
                    # The client stores what it is given and sends it back, so
                    # the history is assembled here exactly as the blocking
                    # endpoint assembles it.
                    event = {
                        **event,
                        "history": _to_json(
                            [
                                *history,
                                NeutralMessage(role="user", text=body.question),
                                NeutralMessage(role="assistant", text=answer_text),
                            ]
                        ),
                    }
                yield f"data: {json.dumps(event, default=str)}\n\n"
        except Exception as exc:  # noqa: BLE001 — the stream must end cleanly
            logger.exception("AI chat stream failed")
            # Too late for a status code; the client watches for this type.
            failure = {
                "type": "error",
                "detail": f"The AI provider could not answer that request: {type(exc).__name__}.",
            }
            yield f"data: {json.dumps(failure)}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # nginx buffers proxied responses by default, which would hold the
            # whole stream back and defeat the point of sending it early.
            "X-Accel-Buffering": "no",
        },
    )
