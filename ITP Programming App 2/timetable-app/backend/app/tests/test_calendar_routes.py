"""API coverage for rolling calendar resolution and administrator overrides."""

from app.database import get_db
from app.main import app
from app.models.schedule_run import ScheduleRun
from fastapi.testclient import TestClient


def _client_for(db_session) -> TestClient:
    def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    return TestClient(app)


def test_context_api_blocks_non_teaching_week(db_session):
    client = _client_for(db_session)
    try:
        response = client.get("/api/calendar/context", params={"date": "2026-06-15"})
        assert response.status_code == 200
        payload = response.json()
        assert payload["week"]["phase"] == "RECESS"
        assert payload["lessons_blocked"] is True
    finally:
        app.dependency_overrides.clear()


def test_context_api_generates_future_provisional_calendar(db_session):
    client = _client_for(db_session)
    try:
        response = client.get("/api/calendar/context", params={"date": "2032-09-06"})
        assert response.status_code == 200
        payload = response.json()
        assert payload["week"]["academic_year"] == "2032/33"
        assert payload["week"]["is_provisional"] is True
    finally:
        app.dependency_overrides.clear()


def test_generation_requires_and_persists_selected_planning_period(db_session):
    client = _client_for(db_session)
    try:
        missing = client.post("/api/schedules/generate")
        assert missing.status_code == 422

        response = client.post(
            "/api/schedules/generate",
            json={"academic_year": "2026/27", "trimester": 1},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["academic_year"] == "2026/27"
        assert payload["trimester"] == 1

        run = db_session.query(ScheduleRun).filter_by(id=payload["schedule_run_id"]).one()
        assert (run.academic_year, run.trimester) == ("2026/27", 1)
    finally:
        app.dependency_overrides.clear()


def test_calendar_week_and_holiday_overrides_are_editable(db_session):
    client = _client_for(db_session)
    try:
        weeks_response = client.get(
            "/api/calendar/weeks",
            params={"academic_year": "2030/31", "trimester": 1},
        )
        assert weeks_response.status_code == 200
        week = weeks_response.json()[0]
        update_response = client.put(
            f"/api/calendar/weeks/{week['id']}",
            json={
                "start_date": week["start_date"],
                "end_date": week["end_date"],
                "phase": "RECESS",
                "notes": "Administrator override",
                "is_provisional": False,
            },
        )
        assert update_response.status_code == 200
        assert update_response.json()["phase"] == "RECESS"
        assert update_response.json()["is_provisional"] is False

        holiday_response = client.post(
            "/api/calendar/holidays",
            json={"date": "2030-09-03", "name": "Campus Holiday", "is_observed": False},
        )
        assert holiday_response.status_code == 200
        holiday = holiday_response.json()
        assert holiday["is_manual_override"] is True

        context_response = client.get("/api/calendar/context", params={"date": "2030-09-03"})
        assert context_response.status_code == 200
        assert context_response.json()["holidays"][0]["name"] == "Campus Holiday"

        delete_response = client.delete(f"/api/calendar/holidays/{holiday['id']}")
        assert delete_response.status_code == 200
    finally:
        app.dependency_overrides.clear()
