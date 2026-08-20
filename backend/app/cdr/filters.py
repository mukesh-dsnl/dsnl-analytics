"""
Turns the shared filter body into a DuckDB WHERE clause, and decides whether
the query has to reach into CODR at all.

Every filter value leaves this module as a bound parameter — the SQL text it
produces contains only `?` placeholders and column names this module chose
itself. Nothing a caller sends is ever concatenated into a statement.

The CDR table is aliased `c` and CODR `o` throughout, whether or not the join
is actually present, so the predicates read the same either way.
"""

from dataclasses import dataclass, field
from typing import Any, Optional

from app.schemas.cdr import CdrFilter

# "all" (and null) mean "no service restriction".
UNRESTRICTED_SERVICE = {None, "", "all"}

# Which services CDR can identify on its own, and which need CODR.
#
# Per Business_Rule.md, CONFEREE_TYPE IN (1, 2) covers conference *and*
# multicall — the two are indistinguishable in CDR alone. Only CODR's
# MODULE_TYPE separates them, so those two services are the only reason to pay
# for the join. Voicedrop is CONFEREE_TYPE = 6 and needs nothing else.
_SERVICE_PREDICATES: dict[str, tuple[str, bool]] = {
    # service      -> (predicate, needs the CODR join)
    "voicedrop": ("c.CONFEREE_TYPE = 6", False),
    "conference": ("o.MODULE_TYPE = 1", True),
    "multicall": ("o.MODULE_TYPE = 4", True),
}

# The full classification, only usable when the join is present. MODULE_TYPE is
# checked first for the reason above; CONFEREE_TYPE catches rows with no
# matching CODR record.
SERVICE_TYPE_EXPR = """CASE
        WHEN o.MODULE_TYPE = 1        THEN 'conference'
        WHEN o.MODULE_TYPE = 3        THEN 'voicedrop'
        WHEN o.MODULE_TYPE = 4        THEN 'multicall'
        WHEN c.CONFEREE_TYPE = 6      THEN 'voicedrop'
        WHEN c.CONFEREE_TYPE IN (1,2) THEN 'conference'
        ELSE 'other'
    END"""


@dataclass
class WhereClause:
    """SQL fragment plus its bound parameters, in matching order."""

    sql: str = ""  # "" or "WHERE ... AND ..."
    params: list[Any] = field(default_factory=list)

    def __bool__(self) -> bool:
        return bool(self.sql)


def needs_codr(service: Optional[str], want_service_type: bool = False) -> bool:
    """
    Whether this query has to join CODR.

    True only when the answer actually depends on MODULE_TYPE: filtering to
    conference or multicall, or reporting SERVICE_TYPE as a column. Every other
    query stays a plain CDR scan, which on a network share is the difference
    that matters.
    """
    if want_service_type:
        return True
    if service in UNRESTRICTED_SERVICE:
        return False
    return _SERVICE_PREDICATES.get(service, ("", False))[1]


def build_where(f: CdrFilter) -> WhereClause:
    """
    Compose the WHERE clause for a filter body.

    The date bounds are applied here as well as in file selection. That is not
    redundant: a file is named for a day, but nothing guarantees every row
    inside it falls on that day, and the range endpoints have to be exact.
    """
    predicates: list[str] = []
    params: list[Any] = []

    if f.service not in UNRESTRICTED_SERVICE:
        predicate, _ = _SERVICE_PREDICATES[f.service]  # type: ignore[index]
        predicates.append(predicate)

    # ACCOUNTID and CRN are integers in the source schema but arrive as strings
    # in the filter body, so both sides are cast to text rather than trusting
    # the caller to send a number.
    if f.account_id:
        predicates.append("CAST(c.ACCOUNTID AS VARCHAR) = ?")
        params.append(str(f.account_id).strip())

    if f.crn:
        predicates.append("CAST(c.CRN AS VARCHAR) = ?")
        params.append(str(f.crn).strip())

    if f.conf_num:
        predicates.append("CAST(c.CONF_NUM AS VARCHAR) = ?")
        params.append(str(f.conf_num).strip())

    # Both date bounds are inclusive. CALL_DATE is the documented day of the
    # call; START_DATETIME stands in for the rows where it is null.
    predicates.append("COALESCE(c.CALL_DATE, CAST(c.START_DATETIME AS DATE)) BETWEEN ? AND ?")
    params.extend([f.date_from, f.date_to])

    # Time-of-day window, applied independently of the date range: "09:00-17:00
    # across all of March" is the useful reading, not "from 9am on day one to
    # 5pm on day thirty".
    if f.time_from:
        predicates.append("CAST(c.START_DATETIME AS TIME) >= ?")
        params.append(f.time_from)
    if f.time_to:
        predicates.append("CAST(c.START_DATETIME AS TIME) <= ?")
        params.append(f.time_to)

    return WhereClause("WHERE " + " AND ".join(predicates), params)
