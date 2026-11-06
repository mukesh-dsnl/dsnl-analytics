"""
Home — the three-service overview on the app's landing page.

    GET /api/home/overview    Voicedrop and Conference, from their summary tables
    GET /api/home/multicall   MultiCall, from the lake — its own call, since a cold
                              lake read takes seconds and the other two need not wait

One card per service, all in the same shape, each from the cheapest source
that has it:

    voicedrop   q100_dump.voicedrop_summary    (Dialout_Count / Connected)
    conference  q100_dump.conference_summary   (Total_Ringed_Calls / Total_Connected_Calls)
    multicall   the CDR lake, last 5 days      (attempts / connected legs)

    units       campaigns · conferences · conferences (distinct CRNs)
    total       dialed out · parties ringed · dial attempts
    connected   connected · parties connected · connected attempts
    minutes     connected minutes · attended minutes · (none in the lake rollup)

A service that cannot be read reports its error in its own card; the others
still load. Each answer is kept for five minutes — this is the first thing
every visit opens.
"""

import logging
import threading
import time
from datetime import date, timedelta
from typing import Any, Callable, Optional

from fastapi import APIRouter

from app.cdr import conference_insights, service, voicedrop_insights
from app.schemas.cdr import CdrFilter

logger = logging.getLogger(__name__)
router = APIRouter()

_SERIES_DAYS = 30
_CACHE_SECONDS = 300
_cache_lock = threading.Lock()
_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def _cached(key: str, build: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    with _cache_lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < _CACHE_SECONDS:
            return hit[1]
    result = build()
    # A failed read is not kept: the next visit tries again.
    if not any(isinstance(card, dict) and card.get("error") for card in result.values()):
        with _cache_lock:
            _cache[key] = (time.time(), result)
    return result


def _rate(part: int, whole: int) -> float:
    return round(part / whole * 100, 1) if whole else 0.0


def _card(daily: list[dict[str, Any]], *, units: str, total: str, connected: str, minutes: Optional[str]) -> dict[str, Any]:
    """
    One summary-table service as a card: its latest day, its month so far,
    and a bar per day for the last 30 — from per-account-per-day rows.
    """
    if not daily:
        return {"as_of": None}
    by_day: dict[date, dict[str, Any]] = {}
    for row in daily:
        day = by_day.setdefault(row["day"], {"units": 0, "total": 0, "connected": 0, "minutes": 0, "accounts": set()})
        day["units"] += row[units]
        day["total"] += row[total]
        day["connected"] += row[connected]
        day["minutes"] += row[minutes] if minutes else 0
        day["accounts"].add(row["account_id"])
    as_of = max(by_day)

    def fold(days: list[date]) -> dict[str, Any]:
        accounts: set = set()
        out = {"units": 0, "total": 0, "connected": 0, "minutes": 0}
        for d in days:
            for key in out:
                out[key] += by_day[d][key]
            accounts |= by_day[d]["accounts"]
        return {**out, "accounts": len(accounts), "connect_rate": _rate(out["connected"], out["total"]), "days": len(days)}

    month_days = [d for d in by_day if d.year == as_of.year and d.month == as_of.month]
    start = as_of - timedelta(days=_SERIES_DAYS - 1)
    return {
        "as_of": as_of.isoformat(),
        "day": fold([as_of]),
        "period": {**fold(month_days), "label": "month"},
        "series": [
            {"date": d.isoformat(), "total": by_day[d]["total"], "connected": by_day[d]["connected"]}
            for d in sorted(by_day) if d >= start
        ],
        "has_minutes": minutes is not None,
    }


def _voicedrop() -> dict[str, Any]:
    return _card(voicedrop_insights._daily_rows(), units="campaigns", total="dialout", connected="connected", minutes="minutes")


def _conference() -> dict[str, Any]:
    return _card(conference_insights._daily_rows(), units="conferences", total="ringed", connected="connected", minutes="attended_minutes")


def _multicall() -> dict[str, Any]:
    """The lake's last few days for MultiCall — it has no summary table."""
    status = service.lake_status()
    if not status.get("available") or not status["cdr"].get("date_max"):
        return {"as_of": None}
    end = date.fromisoformat(status["cdr"]["date_max"])
    days = min(5, int(status.get("max_range_days") or 5))
    rows = service.query_by_date(CdrFilter(date_from=end - timedelta(days=days - 1), date_to=end, service="multicall"))["rows"]
    if not rows:
        return {"as_of": None, "window_days": days}
    rows = sorted(rows, key=lambda r: str(r["call_date"]))

    def fold(selected: list[dict[str, Any]]) -> dict[str, Any]:
        total = sum(int(r["total_rows"]) for r in selected)
        connected = sum(int(r["connected_rows"]) for r in selected)
        return {
            "units": sum(int(r["distinct_crns"]) for r in selected),
            "total": total,
            "connected": connected,
            "minutes": 0,
            # Distinct per day, so summed across days it can count an account twice.
            "accounts": max((int(r["distinct_accounts"]) for r in selected), default=0),
            "connect_rate": _rate(connected, total),
            "days": len(selected),
        }

    last = rows[-1]
    return {
        "as_of": str(last["call_date"]),
        "day": fold([last]),
        "period": {**fold(rows), "label": f"last {days} days"},
        "series": [{"date": str(r["call_date"]), "total": int(r["total_rows"]), "connected": int(r["connected_rows"])} for r in rows],
        "has_minutes": False,
    }


def _safely(name: str, fn: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    try:
        return fn()
    except Exception as exc:  # one service's source being down must not blank the page
        logger.exception("home overview: %s failed", name)
        return {"as_of": None, "error": str(exc)}


@router.get("/home/overview")
def home_overview() -> dict[str, Any]:
    return _cached("overview", lambda: {
        "voicedrop": _safely("voicedrop", _voicedrop),
        "conference": _safely("conference", _conference),
    })


@router.get("/home/multicall")
def home_multicall() -> dict[str, Any]:
    return _cached("multicall", lambda: {"multicall": _safely("multicall", _multicall)})["multicall"]
