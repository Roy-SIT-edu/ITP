"""Built-in, admin-editable lab booking requirements."""

from sqlalchemy import Boolean, Column, Integer, String, Text

from app.database import Base


class LabRequirement(Base):
    __tablename__ = "lab_requirements"

    id = Column(Integer, primary_key=True, index=True)
    requirement_id = Column(String, unique=True, nullable=False, index=True)
    is_active = Column(Boolean, nullable=False, default=True)
    source_sheet = Column(String, nullable=True)
    source_row_no = Column(Integer, nullable=True)
    programme = Column(String, nullable=True)
    raw_programme = Column(String, nullable=True)
    year = Column(Integer, nullable=True)
    module_code = Column(String, nullable=False, index=True)
    student_group = Column(String, nullable=True)
    student_group_codes = Column(Text, nullable=True)
    group_size = Column(Integer, nullable=True)
    fixed_day = Column(String, nullable=True)
    fixed_start_time = Column(String, nullable=True)
    fixed_end_time = Column(String, nullable=True)
    duration_minutes = Column(Integer, nullable=True)
    week_pattern = Column(String, nullable=True)
    custom_weeks = Column(String, nullable=True)
    location = Column(Text, nullable=True)
    required_room_codes = Column(Text, nullable=True)
    staff_names = Column(Text, nullable=True)
    class_type = Column(String, nullable=True)
    delivery_mode = Column(String, nullable=True)
    campus_mode = Column(String, nullable=True)
    venue_type_required = Column(String, nullable=True)
    start_at_7pm = Column(Boolean, nullable=False, default=False)
    setup_turnaround_note = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
