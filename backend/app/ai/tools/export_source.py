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
    # file may be incomplete, which the file says.
    cap: int
    # One line for the file's About sheet: what this data is.
    description: str = ""
    notes: list[str] = field(default_factory=list)
