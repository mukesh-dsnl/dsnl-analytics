"""The dashboard's Total Participants KPI: one per conferee per room per day."""

from app.cdr import service
from app.schemas.cdr import CdrFilter


def _summary(day, **filters):
    rows, _ = service.compute_panels(CdrFilter(date_from=day, date_to=day, **filters), ["summary"])
    return service._shape("summary", rows["summary"])


def test_participants_are_counted_per_service_key(fixture_lake):
    # Voicedrop CRN 101 has three CONFEREE_SEQ_NOs; conference 202 has two
    # rooms (CONF_NUM 1 and 2); multicall 303 has one — six participants.
    summary = _summary(fixture_lake)
    assert summary["total_participants"] == 6
    assert summary["total_phone_numbers"] == 6
    assert _summary(fixture_lake, service="voicedrop")["total_participants"] == 3
