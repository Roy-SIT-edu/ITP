"""SQLAlchemy model for hard and soft schedule validation issues."""

from sqlalchemy import Column, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class ConstraintViolation(Base):
    __tablename__ = "constraint_violations"

    id = Column(Integer, primary_key=True, index=True)
    schedule_run_id = Column(Integer, ForeignKey("schedule_runs.id"), nullable=False)
    constraint_code = Column(String, nullable=False, index=True)
    severity = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    affected_session_ids = Column(String, nullable=True)

    schedule_run = relationship("ScheduleRun", back_populates="constraint_violations")
