"""
One real round-trip against the Gemini API, to verify the adapter.

Run this before trusting `gemini_provider.py` against a new SDK version or a
new model. It exercises exactly the path the orchestrator uses — a system
prompt, a tool spec, a question that should trigger the tool, then the tool
result fed back — and prints the raw response so a changed field name shows up
here rather than three layers down inside the loop.

    cd backend
    ./venv/Scripts/python.exe scripts/verify_gemini.py

Needs GOOGLE_API_KEY, in the environment or in backend/.env. Nothing here
touches the lake: the tool is a stub that returns a fixed number, so a correct
run proves the *transport* — tool declaration, call parsing, result round-trip
— and nothing about the data.
"""

import os
import sys
from pathlib import Path

# Run from anywhere: put backend/ on the path so `app` imports resolve.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.ai.providers.base import NeutralMessage, ToolResult, ToolSpec  # noqa: E402
from app.core.config import get_settings  # noqa: E402

TRIVIAL_TOOL = ToolSpec(
    name="get_call_count",
    description="Get the number of calls for one account on one date.",
    input_schema={
        "type": "object",
        "properties": {
            "account_id": {"type": "string", "description": "The ACCOUNTID."},
            "date": {"type": "string", "format": "date", "description": "YYYY-MM-DD."},
        },
        "required": ["account_id", "date"],
    },
)

STUB_ANSWER = '{"account_id": "4021", "date": "2026-08-20", "calls": 137}'


def main() -> int:
    settings = get_settings()
    api_key = settings.GOOGLE_API_KEY or os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")

    if not api_key:
        print("GOOGLE_API_KEY is not set (checked settings, GOOGLE_API_KEY, GEMINI_API_KEY).")
        print("Set it in backend/.env or the environment, then run this again.")
        return 1

    from app.ai.providers.gemini_provider import GeminiClient

    model = settings.AI_MODEL or None
    client = GeminiClient(model=model, api_key=api_key)
    print(f"provider={client.provider} model={client.model}")
    print("-" * 70)

    # ── Round 1: the model should ask for the tool ──────────────────────────
    history = [
        NeutralMessage(role="user", text="How many calls did account 4021 make on 2026-08-20?")
    ]
    turn = client.send(
        system="You answer questions about call records. Use the tool when one fits.",
        history=history,
        tools=[TRIVIAL_TOOL],
    )

    print(f"round 1  stop_reason={turn.stop_reason}")
    print(f"round 1  text={turn.text!r}")
    for call in turn.tool_calls:
        print(f"round 1  tool_call id={call.id} name={call.name} input={call.input}")

    if turn.stop_reason != "tool_use":
        print("\nThe model did not request the tool. That may be the model's choice rather")
        print("than an adapter fault, but the round-trip below is untested — check the")
        print("tool declaration before trusting this adapter.")
        return 1

    # ── Round 2: feed the result back, expect a prose answer ────────────────
    history.append(
        NeutralMessage(role="assistant", text=turn.text, tool_calls=turn.tool_calls)
    )
    history.append(
        NeutralMessage(
            role="user",
            tool_results=[
                ToolResult(call_id=c.id, name=c.name, content=STUB_ANSWER)
                for c in turn.tool_calls
            ],
        )
    )

    final = client.send(
        system="You answer questions about call records. Use the tool when one fits.",
        history=history,
        tools=[TRIVIAL_TOOL],
    )

    print("-" * 70)
    print(f"round 2  stop_reason={final.stop_reason}")
    print(f"round 2  text={final.text!r}")

    ok = final.stop_reason == "end_turn" and "137" in final.text
    print("-" * 70)
    print("RESULT:", "adapter verified — call and result both round-tripped" if ok else
          "the result did not come back in the answer; check _to_contents()")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
