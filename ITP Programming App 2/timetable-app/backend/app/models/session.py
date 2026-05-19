from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class Session(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    requirement_id = Column(String, nullable=True, index=True)
    programme_id = Column(Integer, ForeignKey("programmes.id"), nullable=True)
    module_id = Column(Integer, ForeignKey("modules.id"), nullable=True)
    student_group_id = Column(Integer, ForeignKey("student_groups.id"), nullable=True)
    staff_id = Column(Integer, ForeignKey("staff.id"), nullable=True)
    class_type = Column(String, nullable=True)
    delivery_mode = Column(String, nullable=True)
    campus_mode = Column(String, nullable=True)
    venue_type_required = Column(String, nullable=True)
    duration_minutes = Column(Integer, nullable=True)
    sessions_per_week = Column(Integer, nullable=True)
    exact_class_size = Column(Integer, nullable=True)
    start_week = Column(Integer, nullable=True)
    end_week = Column(Integer, nullable=True)
    week_pattern = Column(String, nullable=True)
    custom_weeks = Column(String, nullable=True)
    scheduling_type = Column(String, nullable=True)
    fixed_day = Column(String, nullable=True)
    fixed_date = Column(String, nullable=True)
    fixed_start_time = Column(String, nullable=True)
    fixed_end_time = Column(String, nullable=True)
    preferred_days = Column(String, nullable=True)
    avoid_days = Column(String, nullable=True)
    priority = Column(String, nullable=True)
    common_module_flag = Column(Boolean, nullable=False, default=False)
    shared_session_group_id = Column(String, nullable=True)
    combined_with_programmes = Column(String, nullable=True)
    hard_constraint_notes = Column(Text, nullable=True)
    soft_preference_notes = Column(Text, nullable=True)
    remarks = Column(Text, nullable=True)
    source_file = Column(String, nullable=True)
    source_row_no = Column(Integer, nullable=True)

    programme = relationship("Programme", back_populates="sessions")
    module = relationship("Module", back_populates="sessions")
    student_group = relationship("StudentGroup", back_populates="sessions")
    staff = relationship("Staff", back_populates="sessions")
    scheduled_sessions = relationship("ScheduledSession", back_populates="session")
