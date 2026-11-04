"""
Conference › Summary API — conference_summary and conference_daily_summary.

    GET /api/conference-summary/status           the tables' date span
    GET /api/conference-summary/records?date=    one day's conferences
    GET /api/conference-summary/daily?end=&days= one line per day
    GET /api/conference-summary/overview          all accounts: KPIs, calendar,
                                                  hours, sleeping, movers, new
    GET /api/conference-summary/account/{id}      one account's history
    GET /api/conference-summary/statement?month=  per account per month

Read-only; see app/cdr/conference_summary.py for what each column means.
"""

import logging
import re
from datetime import date
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query

from app.cdr import conference_insights as insights
from app.cdr import conference_summary as tables
from app.cdr import voicedrop_summary

logger = logging.getLogger(__name__)
router = APIRouter()


def _read(fn, *args) -> Any:
    try:
        return fn(*args)
    except voicedrop_summary.SourceNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:  # a separate database server; say so rather than a bare 500
        logger.exception("conference summary read failed")
        raise HTTPException(status_code=502, detail=f"Couldn't read the conference summary tables: {exc}")


@router.get("/conference-summary/status")
def conference_status() -> dict[str, Any]:
    return _read(tables.status)


@router.get("/conference-summary/records")
def conference_records(day: date = Query(alias="date")) -> dict[str, Any]:
    return {"date": day.isoformat(), "rows": _read(tables.records_for, day)}


@router.get("/conference-summary/daily")
def conference_daily(end: date, days: int = Query(default=31, ge=1, le=370)) -> dict[str, Any]:
    return {"end": end.isoformat(), "days": days, "rows": _read(tables.daily, end, days)}


@router.get("/conference-summary/overview")
def conference_overview() -> dict[str, Any]:
    return _read(insights.overview)


@router.get("/conference-summary/account/{account_id}")
def conference_account(account_id: int) -> dict[str, Any]:
    result = _read(insights.account, account_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"No conferences for account {account_id}.")
    return result


@router.get("/conference-summary/statement")
def conference_statement(month: Optional[str] = Query(default=None)) -> dict[str, Any]:
    if month is not None and not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise HTTPException(status_code=400, detail="month must be YYYY-MM.")
    return {"month": month, "rows": _read(insights.statement, month)}
