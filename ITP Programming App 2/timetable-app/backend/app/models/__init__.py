"""Central import list for SQLAlchemy models.

Importing this package loads every model class so table creation and tests can
register the full metadata set with SQLAlchemy.
"""

from app.models.constraint_violation import ConstraintViolation
from app.models.module import Module
from app.models.programme import Programme
from app.models.room import Room
from app.models.schedule_run import ScheduleRun
from app.models.scheduled_session import ScheduledSession
from app.models.session import Session
from app.models.staff import Staff
from app.models.student_group import StudentGroup
from app.models.time_slot import TimeSlot

__all__ = [
    "ConstraintViolation",
    "Module",
    "Programme",
    "Room",
    "ScheduleRun",
    "ScheduledSession",
    "Session",
    "Staff",
    "StudentGroup",
    "TimeSlot",
]
