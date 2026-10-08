"""
The shape a tool hands its full result to the file export in.

The tools themselves answer the model, and the model is only ever shown a
capped slice (AI_MAX_ROWS_TO_MODEL). A /csv or /excel export re-runs the same
calls without that cap and streams the rows straight into the file, batch by
batch, so a large result never has to sit in memory and never touches the
model's context.

Each data tool exposes `export_rows(arguments, max_rows)`: a context manager
that yields an `ExportData` while its database connection is open, and raises
`ExportUnavailable` when the call cannot be reproduced.
"""

from dataclasses import dataclass, field
from typing import Iterator

# Rows fetched from DuckDB per round trip while writing a file.
EXPORT_BATCH = 10_000


class ExportUnavailable(Exception):
    """The tool call could not be re-run for export (bad input, data gone)."""


@dataclass
class ExportData:
    columns: list[str]
    # Row tuples in `columns` order, a batch at a time.
    batches: Iterator[list[tuple]]
    # The most rows this source was allowed to return; reaching it means the
    # file may be incomplete, which the download card says.
    cap: int
    # One line saying what this data is, for the logs.
    description: str = ""
    notes: list[str] = field(default_factory=list)


def connect():
    """A fresh DuckDB connection for one tool call, bounded and quiet.

    * Memory is capped at AI_DUCKDB_MEMORY_LIMIT, with AI_DUCKDB_TEMP_DIR to
      spill to past it, so a large aggregation slows down rather than
      exhausting the machine — and fails cleanly if even that is not enough.
    * DuckDB's console progress bar is switched off: in the server log it is a
      wall of block characters between requests. Both can only be set per
      connection, not when opening one.
    """
    from pathlib import Path

    import duckdb

    from app.core.config import get_settings

    settings = get_settings()
    temp_dir = Path(settings.AI_DUCKDB_TEMP_DIR)
    if not temp_dir.is_absolute():
        temp_dir = Path(__file__).resolve().parents[3] / temp_dir
    temp_dir.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect()
    con.execute("SET enable_progress_bar = false")
    con.execute(f"SET memory_limit = '{settings.AI_DUCKDB_MEMORY_LIMIT}'")
    con.execute("SET temp_directory = ?", [temp_dir.as_posix()])
    return con
