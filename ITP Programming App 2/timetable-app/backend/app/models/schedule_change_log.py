"""Persistent audit trail for changes applied to a timetable run."""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String

from app.database import Base
from app.models.schedule_run import utc_now


class ScheduleChangeLog(Base):
    __tablename__ = "schedule_change_logs"

    id = Column(Integer, primary_key=True, index=True)
    schedule_run_id = Column(Integer, ForeignKey("schedule_runs.id"), nullable=False, index=True)
    source_schedule_run_id = Column(Integer, nullable=True)
    session_id = Column(Integer, nullable=False, index=True)
    change_source = Column(String, nullable=False)
    created_at = Column(DateTime, nullable=False, default=utc_now)

    before_day = Column(String, nullable=False)
    before_start_time = Column(String, nullable=False)
    before_end_time = Column(String, nullable=False)
    before_room_code = Column(String, nullable=False)
    before_week_pattern = Column(String, nullable=False)

    after_day = Column(String, nullable=False)
    after_start_time = Column(String, nullable=False)
    after_end_time = Column(String, nullable=False)
    after_room_code = Column(String, nullable=False)
    after_week_pattern = Column(String, nullable=False)
