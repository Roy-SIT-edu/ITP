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


def write_two_tab_template(path: Path, required_rows: list[dict], optional_rows: list[dict] | None = None) -> Path:
    optional_rows = optional_rows or []
    with pd.ExcelWriter(path) as writer:
        pd.DataFrame(required_rows).to_excel(writer, index=False, sheet_name="Input_Template")
        pd.DataFrame(optional_rows, columns=[
            "Requirement ID",
            "Start Week",
            "End Week",
            "Specific Week",
            "Specific Date",
            "Specific Day",
            "Start Time",
            "End Time",
            "Venue Request",
            "Shared Session Group ID",
            "Combined With Programmes",
            "Cleanup Notes",
        ]).to_excel(writer, index=False, sheet_name="Remarks_(optional)")
    return path


def new_template_row(**overrides) -> dict:
    row = {
        "Requirement ID": "REQ-NEW-001",
        "Programme": "DSC",
        "Year": 2,
        "Module Code": "DSC2204",
        "Class Type": "Tutorial",
        "Session Count": 1,
        "Duration Hours": 2,
        "Sessions Per Week": 1,
        "Delivery Mode": "Face-to-face",
        "Venue Type Required": "classroom",
        "Exact Class Size": 40,
        "Staff 1 Name": "Unexpected Display Name",
        "Staff 1 ID": "S001",
        "Staff 2 Name": "",
        "Staff 2 ID": "",
        "Staff 3 Name": "",
        "Staff 3 ID": "",
        "Staff 4 Name": "",
        "Staff 4 ID": "",
    }
    row.update(overrides)
    return row


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
