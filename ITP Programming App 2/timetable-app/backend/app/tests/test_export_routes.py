"""Tests for export route gatekeeping."""

from app.database import get_db
from app.main import app
from app.models.schedule_run import ScheduleRun
from app.services.export_service import SYSTEM_TEMPLATE_COLUMNS
from fastapi.testclient import TestClient


def test_export_route_blocks_runs_with_hard_conflicts(db_session):
    run = ScheduleRun(status="COMPLETED_WITH_CONFLICTS", hard_violation_count=1)
    db_session.add(run)
    db_session.commit()

    def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    try:
        response = TestClient(app).get(f"/api/export/{run.id}/xlsx")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 409
    assert response.json()["detail"]["hard_conflicts"] == 1


def test_export_preview_is_read_only_and_available_before_conflicts_are_resolved(db_session):
    run = ScheduleRun(status="COMPLETED_WITH_CONFLICTS", hard_violation_count=1)
    db_session.add(run)
    db_session.commit()

    def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    try:
        response = TestClient(app).get(f"/api/export/{run.id}/preview")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {
        "schedule_run_id": run.id,
        "columns": SYSTEM_TEMPLATE_COLUMNS,
        "rows": [],
    }
