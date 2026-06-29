"""SQLAlchemy model for teaching module records."""

from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class Module(Base):
    __tablename__ = "modules"

    id = Column(Integer, primary_key=True, index=True)
    module_code = Column(String, nullable=False, index=True)
    module_title = Column(String, nullable=True)
    term = Column(String, nullable=True)

    sessions = relationship("Session", back_populates="module")
