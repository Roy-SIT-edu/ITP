"""Shared helpers for invalidating generated schedule state."""

from app.models.constraint_violation import ConstraintViolation
from app.models.schedule_run import ScheduleRun
from app.models.scheduled_session import ScheduledSession
from sqlalchemy.orm import Session as DbSession


def clear_schedule_state(db: DbSession) -> None:
    """Delete generated runs and conflict reports after inputs change."""

    db.query(ConstraintViolation).delete()
    db.query(ScheduledSession).delete()
    db.query(ScheduleRun).delete()
