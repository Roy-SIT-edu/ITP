"""SQLAlchemy model for generated timetable run metadata."""

from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


def utc_now() -> datetime:
    """Return a UTC timestamp compatible with the existing SQLite column."""

    return datetime.now(UTC).replace(tzinfo=None)


class ScheduleRun(Base):
    __tablename__ = "schedule_runs"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, nullable=False, default=utc_now)
    status = Column(String, nullable=False, default="PENDING")
    solver_status = Column(String, nullable=True)
    hard_violation_count = Column(Integer, nullable=False, default=0)
    soft_score = Column(Integer, nullable=False, default=0)
    message = Column(String, nullable=True)
    academic_year = Column(String, nullable=True)
    trimester = Column(Integer, nullable=True)

    scheduled_sessions = relationship("ScheduledSession", back_populates="schedule_run")
    constraint_violations = relationship(
        "ConstraintViolation",
        back_populates="schedule_run",
    )
