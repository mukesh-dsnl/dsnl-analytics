"""
Tier A — the pre-built breakdowns, offered to the model as one tool.

This wraps `app.cdr.service` and adds nothing to it. Every panel here is a
query the dashboard already runs: the SQL is fixed, the filters are bound
parameters, and the shape of the answer is known. When a question fits one of
these, this is strictly the better path — there is no generated SQL to validate
and no way for the model to get the domain rules wrong, because the rules are
already compiled into the panel.

Errors are returned, not raised. A bad date range or a range the lake can't
cover comes back as `is_error=True` with the message the model needs to try
again. Turning those into a 500 would end the conversation over something the
model could have fixed itself on the next round.

Both tiers are bounded by AI_MAX_RANGE_DAYS, not by the dashboard's
CDR_MAX_RANGE_DAYS: the filter model's ceiling is overridden through validation
context below. One ceiling for both tools means one number to tell the model
about, and it is set for the questions asked here rather than for what a person
will wait out on a panel.
"""

import json
import logging
from typing import Any, Callable

from pydantic import ValidationError

from app.ai.providers.base import ToolSpec
from app.cdr import service
from app.core.config import get_settings
from app.schemas.cdr import CdrFilter

logger = logging.getLogger(__name__)

# The dashboard panels, plus the two breakdowns that aren't panels but answer
# the two questions asked most often of this data: "which accounts" and
# "how did it move day to day".
EXTRA_PANELS = ("by_account", "by_date")
PANEL_CHOICES: tuple[str, ...] = tuple(service.DASHBOARD_PANELS) + EXTRA_PANELS

GET_PANEL_TOOL = ToolSpec(
    name="get_cdr_panel",
    description=(
        "Get one pre-built CDR/CODR breakdown for a date range and optional filters. "
        "Prefer this over run_cdr_query whenever the question matches one of the panels.\n"
        "  summary — total calls (attempts), distinct phone numbers, minutes, conferences. "
        "It does NOT report how many connected; do not read total_calls as a connected count.\n"
        "  connection_status — Connected vs Not Connected counts. This is the panel for "
        "'how many connected', 'connect rate', or 'how many were answered'.\n"
        "  call_direction — Dial In vs Dial Out.\n"
        "  call_funnel — initiated / ringed / connected / ended.\n"
        "  call_duration — connected-call duration, bucketed.\n"
        "  reblast, reblast_aid — blast and retry attempts.\n"
        "  disconnect_reason, service_provider, location, minutes_by_location, "
        "peak_ports, dtmf.\n"
        "  by_account — per-account, per-service totals. by_date — daily totals.\n"
        "Each panel answers one question. If the panel you called does not contain the "
        "figure you were asked for, call the panel that does rather than reporting a "
        "different number from the one you have."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "panel": {
                "type": "string",
                "enum": list(PANEL_CHOICES),
                "description": "Which breakdown to return.",
            },
            "date_from": {"type": "string", "format": "date", "description": "Inclusive start, YYYY-MM-DD."},
            "date_to": {"type": "string", "format": "date", "description": "Inclusive end, YYYY-MM-DD."},
            "service": {
                "type": "string",
                "enum": ["all", "voicedrop", "conference", "multicall"],
                "description": "Restrict to one service. Omit or 'all' for no restriction.",
            },
            "account_id": {"type": "string", "description": "Restrict to one ACCOUNTID."},
            "crn": {"type": "string", "description": "Restrict to one CRN."},
        },
        "required": ["panel", "date_from", "date_to"],
    },
)

# panel name -> the service function that answers it.
_DISPATCH: dict[str, Callable[[CdrFilter], dict]] = {
    "by_account": service.query_by_account,
    "by_date": service.query_by_date,
}


def get_cdr_panel(
    panel: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    service_filter: str | None = None,
    account_id: str | None = None,
    crn: str | None = None,
    **extra: Any,
) -> tuple[str, bool]:
    """Run one pre-built breakdown. Returns (content, is_error).

    `service` is accepted under its schema name through **extra — the parameter
    itself can't be called that without shadowing the imported module.
    """
    chosen_service = service_filter or extra.pop("service", None)

    if extra:
        logger.info(f"get_cdr_panel ignoring unknown arguments: {sorted(extra)}")

    if not panel:
        return (
            f"'panel' is required. Choose one of: {', '.join(PANEL_CHOICES)}.",
            True,
        )

    if panel not in PANEL_CHOICES:
        return (
            f"'{panel}' is not a panel. Choose one of: {', '.join(PANEL_CHOICES)}.",
            True,
        )

    try:
        # The filter model's own validators carry the date rules — parsing,
        # ordering and the range ceiling. The ceiling is overridden to the AI's
        # own budget: the dashboard's CDR_MAX_RANGE_DAYS is tuned for a panel a
        # person is waiting on, and inheriting it here meant a question
        # spanning more days than that could only be answered one day per call.
        filters = CdrFilter.model_validate(
            {
                "date_from": date_from,
                "date_to": date_to,
                "service": chosen_service or None,
                "account_id": account_id,
                "crn": crn,
            },
            context={"max_range_days": get_settings().AI_MAX_RANGE_DAYS},
        )
    except ValidationError as exc:
        # The model reads this to correct itself, so it gets the readable form
        # rather than the JSON error envelope.
        problems = "; ".join(
            f"{'.'.join(str(p) for p in err['loc']) or 'input'}: {err['msg']}"
            for err in exc.errors()
        )
        return (f"Those filters are not valid — {problems}", True)

    try:
        if panel in _DISPATCH:
            result = _DISPATCH[panel](filters)
        else:
            result = service.query_panel(filters, panel)
    except service.DatasetNotReady as exc:
        # Not a failure of the request: the lake simply can't cover that range.
        return (str(exc), True)
    except ValueError as exc:
        return (str(exc), True)

    logger.info(
        f"AI get_cdr_panel panel={panel} range={filters.date_from}..{filters.date_to} "
        f"service={filters.service or 'all'} rows={result.get('row_count', 0)}"
    )
    return (json.dumps(result, default=str), False)
