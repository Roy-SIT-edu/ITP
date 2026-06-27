"""SQLAlchemy model for academic programme records."""

from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class Programme(Base):
    __tablename__ = "programmes"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)
    years = Column(Integer, nullable=True)

    student_groups = relationship("StudentGroup", back_populates="programme")
    sessions = relationship("Session", back_populates="programme")
