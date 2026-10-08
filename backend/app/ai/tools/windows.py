"""
Date windows: how a long range is worked through a few days at a time.

The windowed tools take any range up to AI_MAX_RANGE_DAYS in a single call.
Underneath, they read and aggregate one window of AI_WINDOW_DAYS at a time and
combine the partial results before answering, so

  * memory is bounded by one window's data, not the whole range's;
  * the model spends one round on "all of September", not six;
  * and no window ever has to be told about another.
"""

from datetime import date, timedelta


def split(start: date, end: date, days: int) -> list[tuple[date, date]]:
    """Consecutive inclusive windows of at most `days` days covering start..end."""
    days = max(int(days), 1)
    windows: list[tuple[date, date]] = []
    cursor = start
    while cursor <= end:
        stop = min(cursor + timedelta(days=days - 1), end)
        windows.append((cursor, stop))
        cursor = stop + timedelta(days=1)
    return windows
