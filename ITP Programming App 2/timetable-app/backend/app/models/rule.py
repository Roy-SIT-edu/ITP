"""SQLAlchemy model for data-driven scheduling rules."""

from sqlalchemy import Boolean, Column, Integer, String, Text

from app.database import Base


class Rule(Base):
    __tablename__ = "rules"

    id = Column(Integer, primary_key=True, index=True)
    rule_id = Column(String, nullable=False, unique=True, index=True)
    label = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    severity = Column(String, nullable=False, default="SOFT")
    is_enabled = Column(Boolean, nullable=False, default=True)
    params_json = Column(Text, nullable=False, default="{}")
