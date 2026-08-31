"""
Validation of model-written SQL before it touches the lake.

This is the first of two independent defences, and the weaker one. Text
validation of SQL is inherently a denylist, and a denylist over a language this
large is never provably complete. The real backstop is in `ad_hoc_sql.py`:
after the tables are built, `SET disabled_filesystems='LocalFileSystem'` makes
file access impossible at the engine level, irreversibly, for the rest of that
connection's life — so even a statement that slipped past everything here
cannot read a file. Confirmed on DuckDB 1.5.5: once set it cannot be RESET.

What this module adds on top is *early, explainable* rejection. Every message
it produces is read by the model, not by a person, so each one says what to do
instead. A guard that only says "denied" makes the model retry the same shape;
one that says "query the tables cdr and codr directly" gets a corrected query
on the next round.

Scope is deliberately narrow: one read-only statement over two known tables.
Anything else — a second statement, a write, a file function, an unknown table
— is refused rather than analysed.
"""

import re

from app.core.config import get_settings


class SqlNotAllowed(ValueError):
    """The statement is rejected. The message is written for the model to act on."""


# Forbidden bare words. Matched as whole words on the comment-and-string-
# stripped statement, so a table alias or a column called "set" in a *string
# literal* can't trip it, but the keyword itself always does.
#
# Grouped by what each one would let through if it were allowed:
FORBIDDEN_KEYWORDS: tuple[str, ...] = (
    # Reaching another database or file
    "attach", "detach", "install", "load", "export", "import", "copy",
    # Mutating anything
    "insert", "update", "delete", "drop", "create", "alter", "truncate",
    # Changing engine behaviour — notably, re-enabling a filesystem
    "pragma", "set", "reset",
    # Executing something that isn't this statement
    "call", "system",
    # Reading a file directly, bypassing the temp tables entirely
    "read_parquet", "read_csv", "read_csv_auto", "read_json", "read_json_auto",
    "read_text", "read_blob", "parquet_scan", "csv_scan", "glob",
)

# Substrings that betray a file path however they were assembled.
FORBIDDEN_SUBSTRINGS: tuple[str, ...] = (".parquet", ".csv", ".json")

# The only real tables that exist on the connection.
ALLOWED_TABLES: frozenset[str] = frozenset({"cdr", "codr"})

_LINE_COMMENT = re.compile(r"--[^\n]*")
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
_SINGLE_QUOTED = re.compile(r"'(?:[^']|'')*'")
_DOUBLE_QUOTED = re.compile(r'"(?:[^"]|"")*"')

# `FROM x` / `JOIN x`, capturing the target. Also matches the function-call form
# `FROM read_parquet(...)`, which is what makes an unknown *function* land in
# the same check as an unknown table.
_FROM_JOIN = re.compile(r"\b(?:from|join)\s+([A-Za-z_][\w$]*)", re.IGNORECASE)

# `WITH x AS (` and the `, y AS (` continuations — every CTE name in the
# statement, which are the only other legal FROM targets.
_CTE_NAME = re.compile(r"(?:\bwith\s+(?:recursive\s+)?|,)\s*([A-Za-z_][\w$]*)\s*(?:\([^)]*\)\s*)?as\s*\(", re.IGNORECASE)


def _strip_literals(sql: str) -> str:
    """Comments and quoted strings replaced by blanks, positions preserved.

    Keyword and table checks run on this rather than on the raw text, so that a
    disconnect reason containing the word "set", or a comment mentioning a
    .parquet path, is not mistaken for an attack. Replacing rather than
    deleting keeps offsets stable and, more importantly, stops two separate
    tokens being fused into a new one by the removal.
    """
    blanked = _BLOCK_COMMENT.sub(lambda m: " " * len(m.group()), sql)
    blanked = _LINE_COMMENT.sub(lambda m: " " * len(m.group()), blanked)
    blanked = _SINGLE_QUOTED.sub(lambda m: " " * len(m.group()), blanked)
    return _DOUBLE_QUOTED.sub(lambda m: " " * len(m.group()), blanked)


def _check_keywords(scrubbed: str) -> None:
    for keyword in FORBIDDEN_KEYWORDS:
        # \b won't fire before "(" for names ending in a word char, so the
        # boundary is asserted explicitly on both sides.
        if re.search(rf"(?<![\w$]){re.escape(keyword)}(?![\w$])", scrubbed, re.IGNORECASE):
            raise SqlNotAllowed(
                f"'{keyword}' is not allowed — this tool runs one read-only SELECT. "
                "Do not read files or change any state: query the tables cdr and codr "
                "directly, they are already loaded for the date range you named."
            )


def _check_substrings(scrubbed: str) -> None:
    lowered = scrubbed.lower()
    for fragment in FORBIDDEN_SUBSTRINGS:
        if fragment in lowered:
            raise SqlNotAllowed(
                f"'{fragment}' looks like a file path, and this tool cannot read files. "
                "Query the tables cdr and codr directly — they are already loaded with "
                "exactly the date range you named."
            )


def _check_tables(scrubbed: str) -> None:
    """Every FROM/JOIN target must be cdr, codr, or a CTE this statement defines."""
    known = ALLOWED_TABLES | {name.lower() for name in _CTE_NAME.findall(scrubbed)}

    for target in _FROM_JOIN.findall(scrubbed):
        if target.lower() not in known:
            raise SqlNotAllowed(
                f"'{target}' is not a table you can query. The only tables are cdr and codr "
                "(plus any CTE you define yourself in the same statement). "
                f"Rewrite the query against those."
            )


def validate(sql: str) -> str:
    """Check one statement and return it wrapped in a row cap.

    The wrapper is structural, not advisory: whatever LIMIT the model wrote (or
    omitted) is inside a subquery, so the outer cap holds regardless. Returns
    the SQL to execute; raises SqlNotAllowed with a self-correcting message.
    """
    if sql is None or not sql.strip():
        raise SqlNotAllowed("No SQL was provided. Send one DuckDB SELECT over cdr/codr.")

    statement = sql.strip().rstrip(";").strip()

    # Checked after the single trailing semicolon is stripped, so a harmless
    # statement terminator is tolerated but a second statement is not.
    if ";" in statement:
        raise SqlNotAllowed(
            "Only one statement is allowed, and it must contain no ';'. "
            "Combine what you need into a single SELECT (CTEs are fine)."
        )

    scrubbed = _strip_literals(statement)

    if not re.match(r"^\s*(select|with)\b", scrubbed, re.IGNORECASE):
        raise SqlNotAllowed(
            "The statement must start with SELECT or WITH. This tool is read-only."
        )

    _check_keywords(scrubbed)
    _check_substrings(scrubbed)
    _check_tables(scrubbed)

    limit = get_settings().AI_MAX_ROWS_TO_MODEL
    return f"SELECT * FROM (\n{statement}\n) AS ai_result LIMIT {limit}"
