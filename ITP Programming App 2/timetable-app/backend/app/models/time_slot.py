from sqlalchemy import Column, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship

from app.database import Base


class TimeSlot(Base):
    __tablename__ = "time_slots"
    __table_args__ = (
        UniqueConstraint(
            "day",
            "start_time",
            "end_time",
            "week_pattern",
            name="uq_time_slot_day_time_week",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    day = Column(String, nullable=False, index=True)
    start_time = Column(String, nullable=False)
    end_time = Column(String, nullable=False)
    duration_minutes = Column(Integer, nullable=False)
    week_pattern = Column(String, nullable=False, default="Weekly")

    scheduled_sessions = relationship("ScheduledSession", back_populates="time_slot")
