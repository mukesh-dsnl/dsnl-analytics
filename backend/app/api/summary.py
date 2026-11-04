"""
Voicedrop Summary API — the Overview › Summary page, from voicedrop_summary.

    GET /api/summary/overview             all accounts: KPIs, calendar, hours,
                                          accounts (sleeping), movers, new accounts
    GET /api/summary/account/{account_id} one account's history (?client= for one client of it)
    GET /api/summary/statement?month=     per account per month, for billing

Read-only, like the Campaigns tab it shares the table with; see
app/cdr/voicedrop_insights.py for what each figure means.
"""

import logging
import re
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query

from app.cdr import voicedrop_insights as insights
from app.cdr import voicedrop_summary

logger = logging.getLogger(__name__)
router = APIRouter()


def _read(fn, *args) -> Any:
    try:
        return fn(*args)
    except voicedrop_summary.SourceNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:  # the summary database is a separate server; say so
        logger.exception("voicedrop_summary read failed")
        raise HTTPException(status_code=502, detail=f"Couldn't read voicedrop_summary: {exc}")


@router.get("/summary/overview")
def summary_overview() -> dict[str, Any]:
    return _read(insights.overview)


@router.get("/summary/account/{account_id}")
def summary_account(account_id: int, client: Optional[int] = Query(default=None)) -> dict[str, Any]:
    result = _read(insights.account, account_id, client)
    if result is None:
        who = f"client {client} of account {account_id}" if client is not None else f"account {account_id}"
        raise HTTPException(status_code=404, detail=f"No campaigns for {who}.")
    return result


@router.get("/summary/statement")
def summary_statement(month: Optional[str] = Query(default=None)) -> dict[str, Any]:
    if month is not None and not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise HTTPException(status_code=400, detail="month must be YYYY-MM.")
    return {"month": month, "rows": _read(insights.statement, month)}
