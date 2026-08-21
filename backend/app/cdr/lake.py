"""
Discovery of the CDR/CODR parquet lake.

The lake is two directories of daily exports, named for the day they hold:

    Z:/cdr/cdr_20260817.parquet
    Z:/codr/codr_20260817.parquet

Both paths come from the environment (CDR_LAKE_PATH / CODR_LAKE_PATH). Nothing
is uploaded and nothing is copied locally — queries read these files in place.

The date is in the filename, which is the whole point: a query for one week
resolves to seven paths without opening a single file. Since the lake is an SMB
share, every file *not* opened is the main thing that makes a query fast.

Days may be missing (the export doesn't run every day). A range simply resolves
to the files that exist within it; a gap is not an error.
"""

import logging
import re
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Literal

from app.core.config import get_settings

logger = logging.getLogger(__name__)

Kind = Literal["cdr", "codr"]

# cdr_20260817.parquet / codr_20260817.parquet — the 8 digits are the day.
_FILENAME_RE = re.compile(r"^(cdr|codr)_(\d{8})\.parquet$", re.IGNORECASE)

# Listing a directory on the share costs a round trip, and a dashboard load asks
# for the listing several times over. Holding it briefly turns that into one
# round trip without making a newly-dropped export wait more than a few seconds
# to be noticed.
_LISTING_TTL_SECONDS = 10

_listings: dict[Kind, tuple[float, dict[date, Path]]] = {}


class LakeUnavailable(RuntimeError):
    """A configured lake directory does not exist or cannot be listed."""


def root(kind: Kind) -> Path:
    settings = get_settings()
    return Path(settings.CDR_LAKE_PATH if kind == "cdr" else settings.CODR_LAKE_PATH)


def _scan(kind: Kind) -> dict[date, Path]:
    """Day -> file, for every correctly-named export in the directory."""
    directory = root(kind)
    try:
        entries = list(directory.iterdir())
    except OSError as exc:
        raise LakeUnavailable(
            f"Cannot read the {kind.upper()} directory {directory}: {exc}"
        ) from exc

    days: dict[date, Path] = {}
    for entry in entries:
        match = _FILENAME_RE.match(entry.name)
        if not match:
            continue
        try:
            day = datetime.strptime(match.group(2), "%Y%m%d").date()
        except ValueError:
            logger.warning(f"Ignoring {entry.name}: {match.group(2)} is not a valid date")
            continue
        days[day] = entry
    return days


def available_days(kind: Kind) -> dict[date, Path]:
    """Day -> file for one side of the lake, cached for a few seconds."""
    cached = _listings.get(kind)
    now = time.monotonic()
    if cached and now - cached[0] < _LISTING_TTL_SECONDS:
        return cached[1]

    days = _scan(kind)
    _listings[kind] = (now, days)
    return days


def forget_listings() -> None:
    """Drop the cached listings — used by tests and after a config change."""
    _listings.clear()


def files_for_range(kind: Kind, date_from: date, date_to: date) -> list[Path]:
    """
    The existing export files for every day in an inclusive range, oldest first.

    Missing days are skipped rather than reported: the range is a request for
    "whatever the lake holds between these dates".
    """
    days = available_days(kind)
    return [days[day] for day in sorted(days) if date_from <= day <= date_to]


def coverage() -> dict:
    """
    What the lake currently holds — the basis of GET /api/cdr/status.

    Reported per side, since CDR and CODR are separate directories that can
    fall out of step with each other.
    """
    settings = get_settings()
    result: dict = {
        "max_range_days": settings.CDR_MAX_RANGE_DAYS,
    }

    for kind in ("cdr", "codr"):
        try:
            days = available_days(kind)  # type: ignore[arg-type]
        except LakeUnavailable as exc:
            result[kind] = {"available": False, "error": str(exc), "day_count": 0}
            continue

        if not days:
            result[kind] = {
                "available": False,
                "error": f"No {kind}_YYYYMMDD.parquet files in {root(kind)}.",  # type: ignore[arg-type]
                "day_count": 0,
            }
            continue

        first, last = min(days), max(days)
        span = (last - first).days + 1
        result[kind] = {
            "available": True,
            "day_count": len(days),
            "date_min": first.isoformat(),
            "date_max": last.isoformat(),
            # Days inside the span with no export. Worth surfacing: a chart with
            # a hole in it is otherwise indistinguishable from a quiet day.
            "missing_days": span - len(days),
        }

    result["available"] = result["cdr"]["available"]
    return result


def latest_day() -> date | None:
    """Most recent day the CDR side holds, or None when the lake is empty."""
    try:
        days = available_days("cdr")
    except LakeUnavailable:
        return None
    return max(days) if days else None


def default_day() -> date | None:
    """
    The day the dashboard opens on: yesterday.

    Exports land a day in arrears, so yesterday is the most recent day that is
    reliably complete. When it hasn't arrived (or the lake stops earlier than
    that) the newest day present stands in, so the dashboard opens on data
    rather than on an empty range.
    """
    latest = latest_day()
    if latest is None:
        return None
    return min(date.today() - timedelta(days=1), latest)
