"""Tests for requirements workbook upload routes."""

import pytest
from app import models  # noqa: F401
from app.database import Base, get_db
from app.main import app
from app.models.session import Session
from app.services.schedule_service import ScheduleService
from app.services.seed_service import seed_reference_data, seed_sample_sessions
from app.tests.conftest import valid_row, write_template
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


def _client_for(db) -> TestClient:
    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    return TestClient(app)


def _route_db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'route-test.db'}", connect_args={"check_same_thread": False})
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSession()
    seed_reference_data(db)
    seed_sample_sessions(db)
    db.commit()
    return db


def test_upload_route_imports_valid_workbook(tmp_path):
    db = _route_db(tmp_path)
    path = write_template(tmp_path / "input.xlsx", [valid_row()])
    client = _client_for(db)
    try:
        response = client.post(
            "/api/upload/input-template",
            files={
                "file": (
                    "input.xlsx",
                    path.read_bytes(),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
    finally:
        app.dependency_overrides.clear()
        db.close()

    assert response.status_code == 200
    assert response.json()["rows_imported"] == 1


def test_upload_route_combines_multiple_workbooks(tmp_path):
    db = _route_db(tmp_path)
    first = write_template(tmp_path / "first.xlsx", [valid_row(**{"Requirement ID": "REQ-MULTI-001"})])
    second = write_template(
        tmp_path / "second.xlsx",
        [valid_row(**{"Requirement ID": "REQ-MULTI-002"})],
    )
    client = _client_for(db)
    try:
        response = client.post(
            "/api/upload/input-template",
            files=[
                (
                    "files",
                    (
                        "first.xlsx",
                        first.read_bytes(),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    ),
                ),
                (
                    "files",
                    (
                        "second.xlsx",
                        second.read_bytes(),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    ),
                ),
            ],
        )
        count = db.query(Session).count()
    finally:
        app.dependency_overrides.clear()
        db.close()

    assert response.status_code == 200
    assert response.json()["rows_read"] == 2
    assert response.json()["rows_imported"] == 2
    assert count == 2


def test_upload_route_rejects_duplicate_requirement_ids_across_workbooks(tmp_path):
    db = _route_db(tmp_path)
    first = write_template(tmp_path / "first.xlsx", [valid_row(**{"Requirement ID": "REQ-DUP-001"})])
    second = write_template(tmp_path / "second.xlsx", [valid_row(**{"Requirement ID": "REQ-DUP-001"})])
    client = _client_for(db)
    try:
        before_count = db.query(Session).count()
        response = client.post(
            "/api/upload/input-template",
            files=[
                (
                    "files",
                    (
                        "first.xlsx",
                        first.read_bytes(),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    ),
                ),
                (
                    "files",
                    (
                        "second.xlsx",
                        second.read_bytes(),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    ),
                ),
            ],
        )
        after_count = db.query(Session).count()
    finally:
        app.dependency_overrides.clear()
        db.close()

    assert response.status_code == 200
    assert response.json()["rows_imported"] == 0
    assert response.json()["rows_failed"] >= 1
    assert "Duplicate requirement_id" in response.json()["errors"][0]["message"]
    assert after_count == before_count


def test_upload_route_returns_400_for_unreadable_workbook(tmp_path):
    db = _route_db(tmp_path)
    client = _client_for(db)
    try:
        response = client.post(
            "/api/upload/input-template",
            files={"file": ("broken.xlsx", b"not a workbook", "application/octet-stream")},
        )
    finally:
        app.dependency_overrides.clear()
        db.close()

    assert response.status_code == 400
    assert "Could not read timetable workbook" in response.json()["detail"]


@pytest.mark.parametrize(
    ("sample_id", "expected_fixed_count", "expected_hard_conflicts"),
    [
        ("no-constraints", 0, False),
        ("soft-constraints", 0, False),
        ("hard-constraints", 20, False),
        ("mixed-constraints", 6, True),
    ],
)
def test_demo_sample_workbooks_import_expected_workflows(
    tmp_path,
    sample_id,
    expected_fixed_count,
    expected_hard_conflicts,
):
    db = _route_db(tmp_path)
    client = _client_for(db)
    try:
        catalogue = client.get("/api/upload/demo-samples")
        response = client.post(f"/api/upload/demo-samples/{sample_id}/load")
        fixed_count = db.query(Session).filter(Session.scheduling_type == "Fixed").count()
        generation = ScheduleService().generate(db, reproducible=True)
    finally:
        app.dependency_overrides.clear()
        db.close()

    assert catalogue.status_code == 200
    assert next(item for item in catalogue.json() if item["id"] == sample_id)["available"] is True
    assert response.status_code == 200
    assert response.json()["rows_imported"] == 20
    assert response.json()["rows_failed"] == 0
    assert fixed_count == expected_fixed_count
    assert generation["schedule_run_id"] > 0
    assert (generation["hard_violation_count"] > 0) is expected_hard_conflicts
