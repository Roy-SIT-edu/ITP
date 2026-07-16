"""Tests for manual requirement CRUD and strict reference validation."""

from app.database import Base, get_db
from app.main import app
from app.models.module import Module
from app.models.schedule_run import ScheduleRun
from app.models.session import Session
from app.services.seed_service import seed_reference_data, seed_sample_sessions
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


def _route_db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'route-test.db'}", connect_args={"check_same_thread": False})
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSession()
    seed_reference_data(db)
    seed_sample_sessions(db)
    db.commit()
    return db


def _valid_payload(**overrides):
    payload = {
        "requirement_id": "REQ-CRUD-001",
        "programme": "DSC",
        "module_code": "DSC2204",
        "student_group_code": "DSC-Y1-G1",
        "year": 1,
        "exact_class_size": 30,
        "staff_name": "Dr Tan",
        "staff_id": "S001",
        "class_type": "Tutorial",
        "delivery_mode": "Face-to-face",
        "campus_mode": "Physical",
        "venue_type_required": "classroom",
        "duration_minutes": 120,
        "sessions_per_week": 1,
        "start_week": 1,
        "end_week": 13,
        "week_pattern": "Weekly",
        "scheduling_type": "Flexible",
        "preferred_days": "Monday, Tuesday",
        "avoid_days": "",
        "priority": "Normal",
    }
    payload.update(overrides)
    return payload


def _client_for(db) -> TestClient:
    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    return TestClient(app)


def test_create_session(tmp_path):
    db = _route_db(tmp_path)
    client = _client_for(db)

    try:
        response = client.post(
            "/api/sessions",
            json=_valid_payload(),
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    data = response.json()
    assert data["requirement_id"] == "REQ-CRUD-001"
    assert data["programme"] == "DSC"
    assert data["module_code"] == "DSC2204"
    # Legacy hyphenated codes remain accepted but are returned using the
    # canonical programme/year/partition format used by current reference data.
    assert data["student_group_code"] == "DSC Y1 P1"
    assert data["staff_name"] == "Dr Tan"
    assert data["class_type"] == "Tutorial"
    assert data["duration_minutes"] == 120
    db.close()


def test_get_session_by_id(tmp_path):
    db = _route_db(tmp_path)
    client = _client_for(db)

    create_resp = client.post("/api/sessions", json=_valid_payload(requirement_id="REQ-GET"))
    session_id = create_resp.json()["id"]

    try:
        response = client.get(f"/api/sessions/{session_id}")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["id"] == session_id
    assert response.json()["requirement_id"] == "REQ-GET"
    db.close()


def test_update_session(tmp_path):
    db = _route_db(tmp_path)

    # Create an initial session via API
    client = _client_for(db)
    create_resp = client.post(
        "/api/sessions",
        json=_valid_payload(requirement_id="REQ-CRUD-002"),
    )
    session_id = create_resp.json()["id"]

    try:
        response = client.put(f"/api/sessions/{session_id}", json=_valid_payload(requirement_id="REQ-CRUD-002-MOD", duration_minutes=60))
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    data = response.json()
    assert data["requirement_id"] == "REQ-CRUD-002-MOD"
    assert data["duration_minutes"] == 60
    assert data["class_type"] == "Tutorial"
    db.close()


def test_delete_session(tmp_path):
    db = _route_db(tmp_path)
    client = _client_for(db)

    create_resp = client.post("/api/sessions", json=_valid_payload(requirement_id="REQ-DEL"))
    session_id = create_resp.json()["id"]

    try:
        response = client.delete(f"/api/sessions/{session_id}")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["message"] == "Session deleted successfully"
    assert db.query(Session).filter_by(id=session_id).first() is None
    db.close()


def test_reset_sessions_clears_requirements_and_schedule_state(tmp_path):
    db = _route_db(tmp_path)
    db.add(ScheduleRun(status="COMPLETED", solver_status="FEASIBLE"))
    db.commit()
    client = _client_for(db)

    try:
        assert db.query(Session).count() > 0
        assert db.query(ScheduleRun).count() == 1
        response = client.delete("/api/sessions")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["rows_deleted"] > 0
    assert db.query(Session).count() == 0
    assert db.query(ScheduleRun).count() == 0
    db.close()


def test_create_session_blocks_missing_reference(tmp_path):
    db = _route_db(tmp_path)
    client = _client_for(db)

    try:
        before_count = db.query(Session).count()
        response = client.post(
            "/api/sessions",
            json=_valid_payload(requirement_id="REQ-BAD-MODULE", module_code="MISSING999"),
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    assert any(item["field"] == "Module Code" for item in response.json()["detail"])
    assert db.query(Session).count() == before_count
    assert db.query(Module).filter_by(module_code="MISSING999").first() is None
    db.close()


def test_create_session_blocks_duplicate_requirement_id(tmp_path):
    db = _route_db(tmp_path)
    client = _client_for(db)

    try:
        response = client.post(
            "/api/sessions",
            json=_valid_payload(
                requirement_id="REQ-DEMO-001", student_group_code="DSC-Y2-G1", year=2, exact_class_size=80, venue_type_required="lectorial"
            ),
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    assert any(item["field"] == "Requirement ID" for item in response.json()["detail"])
    db.close()
