from sqlalchemy import Column, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class ScheduledSession(Base):
    __tablename__ = "scheduled_sessions"

    id = Column(Integer, primary_key=True, index=True)
    schedule_run_id = Column(Integer, ForeignKey("schedule_runs.id"), nullable=False)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False)
    time_slot_id = Column(Integer, ForeignKey("time_slots.id"), nullable=False)
    staff_id = Column(Integer, ForeignKey("staff.id"), nullable=True)
    day = Column(String, nullable=False)
    start_time = Column(String, nullable=False)
    end_time = Column(String, nullable=False)
    week_pattern = Column(String, nullable=False)

    schedule_run = relationship("ScheduleRun", back_populates="scheduled_sessions")
    session = relationship("Session", back_populates="scheduled_sessions")
    room = relationship("Room", back_populates="scheduled_sessions")
    time_slot = relationship("TimeSlot", back_populates="scheduled_sessions")
