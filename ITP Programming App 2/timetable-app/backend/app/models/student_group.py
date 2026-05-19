from sqlalchemy import Column, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class StudentGroup(Base):
    __tablename__ = "student_groups"

    id = Column(Integer, primary_key=True, index=True)
    group_code = Column(String, unique=True, nullable=False, index=True)
    programme_id = Column(Integer, ForeignKey("programmes.id"), nullable=True)
    year = Column(Integer, nullable=True)
    size = Column(Integer, nullable=True)

    programme = relationship("Programme", back_populates="student_groups")
    sessions = relationship("Session", back_populates="student_group")
