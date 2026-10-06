"""Small, read-only lookups against the production MultiCall source tables.

Search performs one exact-match SELECT over comma-separated value lists. Opening a registration performs one
SELECT for that registration and its first page of profiles. Further pages are
requested only when the user explicitly asks for them. Profile selection is
handled entirely by the client from the fetched rows.
"""

from datetime import date, datetime
from functools import lru_cache

from sqlalchemy import bindparam, create_engine, text

from app.core.config import get_settings

SEARCH_LIMIT = 200
MAX_VALUES_PER_FIELD = 100
PROFILE_PAGE_SIZE = 50

# Only Reg Nums divisible by 8 are main accounts; every other Reg Num is a
# duplicate registration and is never shown.
MAIN_REG_CONDITION = "MOD(r.RegNum, 8) = 0"


class SourceNotConfigured(RuntimeError):
    """No production MultiCall source connection has been configured."""


@lru_cache()
def source_engine():
    url = get_settings().MULTICALL_DATABASE_URL
    if not url:
        raise SourceNotConfigured("Set MULTICALL_DATABASE_URL to a read-only source connection.")
    return create_engine(url, pool_pre_ping=True)


def _value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, bytes):
        return int.from_bytes(value, "big") if len(value) == 1 else value.decode("utf-8", errors="replace")
    return value


def _record(row) -> dict:
    return {key: _value(value) for key, value in row.items()}


SEARCH_FIELDS = ("reg_nums", "phones", "emails", "cpins")

# Each searched list becomes one expanding IN (...) parameter. Every branch is
# a plain lookup on a single column so it can use that column's index; the
# branches are combined with UNION ALL rather than OR-ing correlated EXISTS
# clauses, which would force a scan of the whole registration table. Phone and
# email also match contacts stored on profiles; CPIN only exists on profiles.
# The third column names the profile that matched, so the UI can point at it.
_MATCH_BRANCHES = {
    "reg_nums": [
        "SELECT RegNum, 'reg_nums' AS hit, NULL AS ref FROM MultiCallRegistration WHERE RegNum IN :reg_nums",
    ],
    "phones": [
        "SELECT RegNum, 'phones' AS hit, NULL AS ref FROM MultiCallRegistration WHERE Phone IN :phones",
        "SELECT RegNum, 'phones' AS hit, ProfileRefNum AS ref FROM MultiCallProfile WHERE ProfilePhone IN :phones",
    ],
    "emails": [
        "SELECT RegNum, 'emails' AS hit, NULL AS ref FROM MultiCallRegistration WHERE LowercaseEmailID IN :emails",
        "SELECT RegNum, 'emails' AS hit, NULL AS ref FROM MultiCallRegistration WHERE EmailID IN :emails",
        "SELECT RegNum, 'emails' AS hit, ProfileRefNum AS ref FROM MultiCallProfile WHERE LOWER(ProfileEmailID) IN :emails",
    ],
    "cpins": [
        "SELECT RegNum, 'cpins' AS hit, ProfileRefNum AS ref FROM MultiCallProfile WHERE ChairpersonPin IN :cpins",
    ],
}


def search_registrations(criteria: dict[str, list[str]]) -> dict:
    """Exact IN-list lookup across RegNum, phone, email and CPIN; an account
    matching any supplied value is returned. Never a table-wide browse."""
    values = {field: list(criteria.get(field) or []) for field in SEARCH_FIELDS}
    values["emails"] = [value.lower() for value in values["emails"]]
    fields = [field for field in SEARCH_FIELDS if values[field]]
    if not fields:
        return {"rows": [], "truncated": False}

    branches = " UNION ALL ".join(branch for field in fields for branch in _MATCH_BRANCHES[field])
    flags = ", ".join(
        f"MAX(CASE WHEN u.hit = '{field}' THEN 1 ELSE 0 END) AS matched_{field}" for field in fields
    )
    statement = text(f"""
        SELECT r.RegNum AS reg_num, r.Name AS name, r.Phone AS phone,
               r.EmailID AS email, r.UpdatedDateTime AS updated_at,
               r.SocialNetworkFlag AS source,
               (SELECT COUNT(*) FROM MultiCallProfile cp WHERE cp.RegNum = r.RegNum) AS profile_count,
               (SELECT COUNT(*) FROM MultiCallProfile cp WHERE cp.RegNum = r.RegNum AND cp.Status = 1) AS active_profile_count,
               m.*
        FROM (
            SELECT u.RegNum AS match_reg_num, GROUP_CONCAT(DISTINCT u.ref) AS matched_profiles, {flags}
            FROM ({branches}) u
            GROUP BY u.RegNum
        ) m
        JOIN MultiCallRegistration r ON r.RegNum = m.match_reg_num
        WHERE {MAIN_REG_CONDITION}
        ORDER BY r.RegNum DESC
        LIMIT :limit
    """).bindparams(*(bindparam(field, expanding=True) for field in fields))
    params = {field: values[field] for field in fields}
    params["limit"] = SEARCH_LIMIT + 1
    with source_engine().connect() as connection:
        rows = [_record(row) for row in connection.execute(statement, params).mappings()]

    results = []
    for row in rows[:SEARCH_LIMIT]:
        row.pop("match_reg_num")
        refs = row.pop("matched_profiles")
        row["matched_profiles"] = [ref for ref in str(refs).split(",") if ref] if refs else []
        row["matched_on"] = [field for field in fields if row.pop(f"matched_{field}")]
        results.append(row)
    return {"rows": results, "truncated": len(rows) > SEARCH_LIMIT}


def registration_with_profiles(reg_num: str, page: int) -> dict | None:
    """One joined read for a main registration's details and one bounded profile page."""
    statement = text(f"""
        SELECT r.RegNum AS reg_num, r.Name AS name, r.Phone AS phone,
               r.EmailID AS email, r.UpdatedDateTime AS updated_at,
               r.SocialNetworkFlag AS source,
               p.ProfileRefNum AS profile_ref_num, p.ProfileName AS profile_name,
               p.ProfilePhone AS profile_phone, p.ProfileEmailID AS profile_email,
               p.ConfRefNum AS conf_ref_num, p.ChairpersonPin AS chair_pin,
               p.ParticipantPin AS participant_pin, p.Status AS status,
               p.AccountType AS account_type, p.ISDAllowStatus AS isd_allowed,
               p.ProfileSize AS profile_size, p.AckStatus AS ack_status,
               p.AddedDateTime AS added_at, p.UpdatedDateTime AS profile_updated_at,
               p.ProfileDefault AS is_default
        FROM MultiCallRegistration r
        LEFT JOIN MultiCallProfile p ON p.RegNum = r.RegNum
        WHERE r.RegNum = :reg_num AND {MAIN_REG_CONDITION}
        ORDER BY p.ProfileRefNum DESC
        LIMIT :limit OFFSET :offset
    """)
    params = {
        "reg_num": reg_num,
        "limit": PROFILE_PAGE_SIZE + 1,
        "offset": (page - 1) * PROFILE_PAGE_SIZE,
    }
    with source_engine().connect() as connection:
        rows = [_record(row) for row in connection.execute(statement, params).mappings()]
    if not rows:
        return None

    first = rows[0]
    registration = {
        key: first[key]
        for key in ("reg_num", "name", "phone", "email", "updated_at", "source")
    }
    profiles = []
    for row in rows[:PROFILE_PAGE_SIZE]:
        if row["profile_ref_num"] is None:
            continue
        profile = {key: value for key, value in row.items() if key not in registration}
        profiles.append(profile)
    return {
        "registration": registration,
        "profiles": profiles,
        "page": page,
        "has_more": len(rows) > PROFILE_PAGE_SIZE,
    }
