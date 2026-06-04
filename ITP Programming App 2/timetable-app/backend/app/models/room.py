"""SQLAlchemy model for room and virtual venue records."""

from sqlalchemy import Boolean, Column, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class Room(Base):
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True, index=True)
    room_code = Column(String, unique=True, nullable=False, index=True)
    room_name = Column(String, nullable=False)
    room_type = Column(String, nullable=False)
    capacity = Column(Integer, nullable=False)
    is_virtual = Column(Boolean, nullable=False, default=False)
    campus_mode = Column(String, nullable=False, default="Physical")
    recording_available = Column(Boolean, nullable=False, default=False)

    scheduled_sessions = relationship("ScheduledSession", back_populates="room")
