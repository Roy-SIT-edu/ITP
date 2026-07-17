"""Dated occurrences derived from a generated weekly timetable."""

from sqlalchemy import Column, Date, ForeignKey, Integer, String, UniqueConstraint

from app.database import Base


class SessionOccurrence(Base):
    __tablename__ = "session_occurrences"
    __table_args__ = (
        UniqueConstraint(
            "scheduled_session_id",
            "occurrence_date",
            name="uq_scheduled_session_occurrence_date",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    schedule_run_id = Column(Integer, ForeignKey("schedule_runs.id"), nullable=False, index=True)
    scheduled_session_id = Column(Integer, ForeignKey("scheduled_sessions.id"), nullable=False, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False, index=True)
    occurrence_date = Column(Date, nullable=False, index=True)
    academic_year = Column(String, nullable=False)
    trimester = Column(Integer, nullable=False)
    week_number = Column(Integer, nullable=False)
    status = Column(String, nullable=False, default="SCHEDULED")
    reason = Column(String, nullable=True)
    holiday_name = Column(String, nullable=True)
