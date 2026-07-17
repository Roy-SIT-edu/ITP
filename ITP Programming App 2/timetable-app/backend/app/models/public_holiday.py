"""Singapore public holidays used as blocked timetable dates."""

from sqlalchemy import Boolean, Column, Date, Integer, String

from app.database import Base


class PublicHoliday(Base):
    __tablename__ = "public_holidays"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False, unique=True, index=True)
    name = Column(String, nullable=False)
    is_observed = Column(Boolean, nullable=False, default=False)
    source = Column(String, nullable=False, default="MOM/data.gov.sg")
    is_manual_override = Column(Boolean, nullable=False, default=False)
