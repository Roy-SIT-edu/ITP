"""SQLAlchemy model for staff records used by requirement validation."""

from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class Staff(Base):
    __tablename__ = "staff"

    id = Column(Integer, primary_key=True, index=True)
    staff_name = Column(String, nullable=True, index=True)
    staff_id = Column(String, unique=True, nullable=True, index=True)

    sessions = relationship("Session", back_populates="staff")
    session_assignments = relationship("SessionStaff", back_populates="staff")
