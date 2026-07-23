"""Helpers for recording timetable placement changes."""

from app.models.schedule_change_log import ScheduleChangeLog
from app.models.scheduled_session import ScheduledSession
from sqlalchemy.orm import Session as DbSession

PLACEMENT_FIELDS = ("day", "start_time", "end_time", "room_code", "week_pattern")


def placement_snapshot(item: ScheduledSession) -> dict[str, str]:
    """Capture the reportable placement fields before or after a move."""

    return {
        "day": item.day,
        "start_time": item.start_time,
        "end_time": item.end_time,
        "room_code": item.room.room_code,
        "week_pattern": item.week_pattern,
    }


def changed_placement_fields(before: dict, after: dict) -> list[str]:
    labels = {
        "day": "Day",
        "start_time": "Time",
        "end_time": "Time",
        "room_code": "Room",
        "week_pattern": "Week pattern",
    }
    changed = []
    for field in PLACEMENT_FIELDS:
        label = labels[field]
        if before.get(field) != after.get(field) and label not in changed:
            changed.append(label)
    return changed


def record_schedule_change(
    db: DbSession,
    *,
    schedule_run_id: int,
    session_id: int,
    change_source: str,
    before: dict[str, str],
    after: dict[str, str],
    source_schedule_run_id: int | None = None,
) -> ScheduleChangeLog | None:
    """Stage one audit row, ignoring placement requests that change nothing."""

    if not changed_placement_fields(before, after):
        return None

    change = ScheduleChangeLog(
        schedule_run_id=schedule_run_id,
        source_schedule_run_id=source_schedule_run_id,
        session_id=session_id,
        change_source=change_source,
        before_day=before["day"],
        before_start_time=before["start_time"],
        before_end_time=before["end_time"],
        before_room_code=before["room_code"],
        before_week_pattern=before["week_pattern"],
        after_day=after["day"],
        after_start_time=after["start_time"],
        after_end_time=after["end_time"],
        after_room_code=after["room_code"],
        after_week_pattern=after["week_pattern"],
    )
    db.add(change)
    return change
