"""Persistent academic calendar week definitions."""

from sqlalchemy import Boolean, Column, Date, Integer, String, UniqueConstraint

from app.database import Base


class AcademicWeek(Base):
    __tablename__ = "academic_weeks"
    __table_args__ = (
        UniqueConstraint(
            "academic_year",
            "trimester",
            "week_number",
            name="uq_academic_week_year_trimester_number",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    academic_year = Column(String, nullable=False, index=True)
    trimester = Column(Integer, nullable=False, index=True)
    week_number = Column(Integer, nullable=False)
    start_date = Column(Date, nullable=False, index=True)
    end_date = Column(Date, nullable=False, index=True)
    phase = Column(String, nullable=False)
    is_provisional = Column(Boolean, nullable=False, default=False)
    notes = Column(String, nullable=True)
