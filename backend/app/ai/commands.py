"""
Slash commands in a chat question: /voicedrop /conference /multicall
/voicedrop-report /csv /excel /chart.

They travel inside the question text ("/voicedrop /excel top accounts last
week"), so the stored question shows exactly what was asked — commands and
all — and the request format did not need to change. The server is what
decides what they mean:

  scope    /voicedrop /conference /multicall — narrow the question to services
  report   /voicedrop-report — answer with the phone-number list (voicedrop_report)
  export   /csv /excel — attach the full result rows as a file (see exports.py)
  display  /chart — ask for one chartable table; the browser draws the chart

Commands are recognised anywhere in the text, case-insensitively, but only the
known names: "/foo" or a path like "a/b" stays as ordinary text.
"""

import re
from dataclasses import dataclass, field

SCOPES = ("voicedrop", "conference", "multicall")
EXPORTS = ("csv", "excel")
DISPLAYS = ("chart",)
REPORTS = ("voicedrop-report",)
ALL = SCOPES + EXPORTS + DISPLAYS + REPORTS

# File extension per export command.
EXPORT_FORMATS = {"csv": "csv", "excel": "xlsx"}

# Longest names first, and a command may not run on into more letters or a
# hyphen: otherwise "/voicedrop-report" would be read as "/voicedrop".
_TOKEN = re.compile(
    r"(?<![\w/])/(" + "|".join(sorted(ALL, key=len, reverse=True)) + r")(?![\w-])",
    re.IGNORECASE,
)

_SERVICE_LABEL = {"voicedrop": "Voicedrop", "conference": "Conference", "multicall": "MultiCall"}


@dataclass
class Parsed:
    commands: list[str] = field(default_factory=list)
    # The question with the command tokens removed — what the model is asked.
    text: str = ""

    @property
    def scopes(self) -> list[str]:
        return [c for c in self.commands if c in SCOPES]

    @property
    def wants_report(self) -> bool:
        return "voicedrop-report" in self.commands

    @property
    def exports(self) -> list[str]:
        return [c for c in self.commands if c in EXPORTS]

    @property
    def wants_chart(self) -> bool:
        return "chart" in self.commands


def parse(question: str) -> Parsed:
    """Pull the known commands out of a question, in order, without repeats."""
    commands: list[str] = []
    for match in _TOKEN.finditer(question or ""):
        name = match.group(1).lower()
        if name not in commands:
            commands.append(name)
    text = re.sub(r"[ \t]{2,}", " ", _TOKEN.sub("", question or "")).strip()
    return Parsed(commands=commands, text=text)


def strip(question: str) -> str:
    """A stored question as the model should read it in history."""
    parsed = parse(question)
    if not parsed.commands:
        return question
    return f"[{', '.join('/' + c for c in parsed.commands)}] {parsed.text}".strip()


def instructions(parsed: Parsed) -> str:
    """The prompt section that tells the model what this question's commands mean."""
    if not parsed.commands:
        return ""

    lines = ["", "=== Commands for this question ===", ""]

    scopes = parsed.scopes
    if len(scopes) == 1:
        label = _SERVICE_LABEL[scopes[0]]
        lines.append(
            f"  - Scope: {label} only. Pass service=\"{scopes[0]}\" to every tool that "
            f"accepts it, and in run_cdr_query restrict to {label} using the service "
            "classification rules above. Do not report other services."
        )
    elif scopes:
        labels = ", ".join(_SERVICE_LABEL[s] for s in scopes)
        lines.append(
            f"  - Scope: only these services: {labels}. Use group_by service_type (or "
            "the service classification rules above) and report just these services, "
            "each separately."
        )

    if parsed.exports:
        kinds = " and ".join("an Excel workbook" if e == "excel" else "a CSV file" for e in parsed.exports)
        lines.append(
            f"  - Export: the full rows of your data tool calls will be attached to this "
            f"answer as {kinds}, automatically, with every row — including rows past "
            "the limit of what the tools show you. So when a result says it was "
            "truncated, that is only your preview: do not report its row count as the "
            "total, and do not re-query to fetch the rest. Do not add a row limit the "
            "question did not ask for — no LIMIT in SQL and no `limit` argument just "
            "to keep the answer short; the tools already cap what you are shown. "
            "Answer the way a file attachment is described, not with the data: do "
            "NOT include a table in your reply unless the question explicitly asks to "
            "see rows in the chat. Instead, in a few short lines, say what the file "
            "contains — what each row is, its columns, the date range and filters "
            "applied — and the headline totals from the tool result (rows, connected, "
            "minutes or whatever the question is about). The download card under your "
            "reply shows the file's name, size and row count, so do not repeat those."
        )

    if parsed.wants_report:
        lines.append(
            "  - Report: this is a Voicedrop phone-number question. Answer it with the "
            "voicedrop_report tool — one row per number dialled per campaign per day, with "
            "its status, total duration and attempts across retries. Pass the account, "
            "CRNs, phone numbers and status the question names, and the whole date range "
            "in one call."
        )

    if parsed.wants_chart:
        lines.append(
            "  - Chart: present the main result as one markdown table — the first column "
            "the label (date, account, carrier...), then one or more numeric columns. "
            "The page draws a chart from that table, so keep numbers plain."
        )

    return "\n".join(lines) + "\n"
