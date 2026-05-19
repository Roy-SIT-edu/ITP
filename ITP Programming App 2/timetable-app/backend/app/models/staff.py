from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class Staff(Base):
    __tablename__ = "staff"

    id = Column(Integer, primary_key=True, index=True)
    staff_name = Column(String, nullable=True, index=True)
    staff_id = Column(String, unique=True, nullable=True, index=True)
    staff_host_key = Column(String, nullable=True)

    sessions = relationship("Session", back_populates="staff")
