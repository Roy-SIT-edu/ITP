"""Shared pytest fixtures and workbook helpers for backend tests."""

from pathlib import Path

import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models  # noqa: F401
from app.database import Base
from app.services.seed_service import seed_reference_data, seed_sample_sessions


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSession()
    seed_reference_data(db)
    seed_sample_sessions(db)
    db.commit()
    try:
        yield db
    finally:
        db.close()


def write_template(path: Path, rows: list[dict]) -> Path:
    pd.DataFrame(rows).to_excel(path, index=False, sheet_name="Input_Template")
    return path


def valid_row(**overrides) -> dict:
    row = {
        "Requirement ID": "REQ-TEST-001",
        "Programme": "DSC",
        "Year": 2,
        "Student Group Code": "DSC-Y2-G1",
        "Module Code": "DSC2204",
        "Module Host Key": "DSC",
        "Class Type": "Tutorial",
        "Session Count": 1,
        "Duration Hours": 2,
        "Sessions Per Week": 1,
        "Delivery Mode": "Face-to-face",
        "Venue Type Required": "classroom",
        "Campus Mode": "Physical",
        "Exact Class Size": 40,
        "Staff 1 Name": "Dr Tan",
        "Staff 1 ID": "S001",
        "Start Week": 1,
        "End Week": 13,
        "Week Pattern": "Weekly",
        "Scheduling Type": "Flexible",
        "Preferred Days": "Monday,Tuesday",
        "Avoid Days": "",
        "Priority": "Normal",
    }
    row.update(overrides)
    return row
