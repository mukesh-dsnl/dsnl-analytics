"""Authenticated, on-demand MultiCall registration lookups."""

import logging
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, StringConstraints, field_validator
from sqlalchemy.exc import SQLAlchemyError

from app.multicall import service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/multicall")


SearchValue = Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]
SearchValues = Annotated[list[SearchValue], Field(default_factory=list, max_length=service.MAX_VALUES_PER_FIELD)]


class SearchRequest(BaseModel):
    """Each list holds the comma-separated values typed into one search box."""

    reg_nums: SearchValues
    phones: SearchValues
    emails: SearchValues
    cpins: SearchValues

    @field_validator("reg_nums", "phones", "emails", "cpins")
    @classmethod
    def _distinct(cls, values: list[str]) -> list[str]:
        return list(dict.fromkeys(value for value in values if value))


def _unavailable(exc: SQLAlchemyError) -> HTTPException:
    # Avoid logging the SQL exception itself: it can contain the search value,
    # including a chairperson PIN, in its bound-parameter description.
    logger.error("MultiCall lookup failed (%s)", type(exc).__name__)
    return HTTPException(
        status_code=503,
        detail="MultiCall data is unavailable. Check the source database and read permissions.",
    )


@router.post("/search")
def search(body: SearchRequest):
    criteria = body.model_dump()
    if not any(criteria.values()):
        raise HTTPException(status_code=422, detail="Enter a Reg Num, phone, email, or CPIN to search.")
    try:
        return service.search_registrations(criteria)
    except service.SourceNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    except SQLAlchemyError as exc:
        raise _unavailable(exc) from None


@router.get("/registrations/{reg_num}")
def registration(reg_num: str, page: int = Query(1, ge=1, le=10000)):
    try:
        result = service.registration_with_profiles(reg_num, page)
    except service.SourceNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    except SQLAlchemyError as exc:
        raise _unavailable(exc) from None
    if result is None:
        raise HTTPException(status_code=404, detail="Registration not found.")
    return result
