"""
Port Analyzer API.

    POST /api/ports/analyze   one day's ports in use, with its filters and breakdown

Read-only, from the CDR lake; see app/cdr/ports.py for the logic.
"""

from datetime import date, time
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.cdr import ports
from app.cdr.service import DatasetNotReady

router = APIRouter()


class PortRequest(BaseModel):
    date: date
    service: Literal["all", "voicedrop", "conference", "multicall"] = "all"
    time_from: time = time(0, 0, 0)
    time_to: time = time(23, 59, 59)
    resolution: str = "1m"
    group_by: str = "none"
    service_providers: list[str] = Field(default_factory=list)
    accounts: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    top: int = 8
    capacity: Optional[int] = Field(default=None, ge=0)


@router.post("/ports/analyze")
def analyze_ports(body: PortRequest) -> dict:
    try:
        return ports.analyze(
            day=body.date,
            service=body.service,
            time_from=body.time_from,
            time_to=body.time_to,
            resolution=body.resolution,
            group_by=body.group_by,
            providers=[p.strip() for p in body.service_providers if p.strip()],
            accounts=[a.strip() for a in body.accounts if a.strip()],
            locations=[loc.strip() for loc in body.locations if loc.strip()],
            top=body.top,
            capacity=body.capacity,
        )
    except ports.PortQueryError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except DatasetNotReady as exc:
        raise HTTPException(status_code=409, detail=str(exc))
