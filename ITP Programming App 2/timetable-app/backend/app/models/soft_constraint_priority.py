"""SQLAlchemy model for user-ranked soft scheduling priorities."""

from sqlalchemy import Column, Integer, String

from app.database import Base


class SoftConstraintPriority(Base):
    __tablename__ = "soft_constraint_priorities"

    id = Column(Integer, primary_key=True, index=True)
    constraint_code = Column(String, nullable=False, unique=True, index=True)
    rank = Column(Integer, nullable=False)
    weight = Column(Integer, nullable=False)
