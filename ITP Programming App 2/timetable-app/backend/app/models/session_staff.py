"""Association model for all staff assigned to a requirement session."""

from sqlalchemy import Boolean, Column, ForeignKey, Integer
from sqlalchemy.orm import relationship

from app.database import Base


class SessionStaff(Base):
    __tablename__ = "session_staff"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False, index=True)
    staff_id = Column(Integer, ForeignKey("staff.id"), nullable=False, index=True)
    staff_order = Column(Integer, nullable=False, default=1)
    is_primary = Column(Boolean, nullable=False, default=False)

    session = relationship("Session", back_populates="staff_assignments")
    staff = relationship("Staff", back_populates="session_assignments")
