"""Tests for split database APIs, example files, and schedule compatibility."""

from io import BytesIO

import pandas as pd
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models  # noqa: F401
from app.database import Base, create_db_and_seed, create_session_factory, dispose_engines, get_db
from app.main import app
from app.models.room import Room
from app.models.rule import Rule
from app.models.schedule_run import ScheduleRun
from app.models.staff import Staff
from app.services.schedule_service import ScheduleService
from app.services.seed_service import seed_reference_data, seed_sample_sessions


def _workbook(rows: list[dict]) -> bytes:
    buffer = BytesIO()
    pd.DataFrame(rows).to_excel(buffer, index=False)
    buffer.seek(0)
    return buffer.getvalue()


def _route_db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'database-routes.db'}", connect_args={"check_same_thread": False})
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSession()
    seed_reference_data(db)
    seed_sample_sessions(db)
    db.commit()
    return db, engine


def _client_for(db) -> TestClient:
    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    return TestClient(app)


def test_split_database_files_are_created_and_seeded(tmp_path):
    data_dir = tmp_path / "data"
    create_db_and_seed(data_dir=data_dir, legacy_database_path=tmp_path / "missing.db")

    assert sorted(path.name for path in data_dir.glob("*.db")) == [
        "modules.db",
        "programmes.db",
        "requirements.db",
        "rooms.db",
        "schedule_state.db",
        "staff.db",
        "student_groups.db",
        "time_slots.db",
    ]

    SessionLocal, engines = create_session_factory(data_dir)
    db = SessionLocal()
    try:
        assert db.query(Room).count() == 6
        assert db.query(Staff).count() == 3
        assert db.query(Rule).filter_by(rule_id="CLASS_AFTER_1700").count() == 1
    finally:
        db.close()
        dispose_engines(engines)


def test_database_types_include_rules(tmp_path):
    db, engine = _route_db(tmp_path)
    client = _client_for(db)
    try:
        response = client.get("/api/database/types")
    finally:
        app.dependency_overrides.clear()
        db.close()
        engine.dispose()

    assert response.status_code == 200
    assert any(item["id"] == "rules" for item in response.json())


def test_database_example_workbook_contains_live_data(tmp_path):
    db, engine = _route_db(tmp_path)
    client = _client_for(db)
    try:
        response = client.get("/api/database/rooms/example.xlsx")
    finally:
        app.dependency_overrides.clear()
        db.close()
        engine.dispose()

    assert response.status_code == 200
    frame = pd.read_excel(BytesIO(response.content))
    assert "room_code" in frame.columns
    assert "SR-01" in set(frame["room_code"])


def test_replace_upload_success_and_validation_rollback(tmp_path):
    db, engine = _route_db(tmp_path)
    client = _client_for(db)
    try:
        valid_upload = _workbook(
            [
                {
                    "room_code": "ROOM-A",
                    "room_name": "Room A",
                    "room_type": "classroom",
                    "capacity": 50,
                    "is_virtual": False,
                    "campus_mode": "Physical",
                    "recording_available": False,
                }
            ]
        )
        response = client.post(
            "/api/database/rooms/upload",
            files={"file": ("rooms.xlsx", valid_upload, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert response.status_code == 200
        assert response.json()["rows_imported"] == 1
        assert db.query(Room).count() == 1

        invalid_upload = _workbook(
            [
                {
                    "room_code": "",
                    "room_name": "Broken",
                    "room_type": "classroom",
                    "capacity": 40,
                    "is_virtual": False,
                    "campus_mode": "Physical",
                    "recording_available": False,
                }
            ]
        )
        response = client.post(
            "/api/database/rooms/upload",
            files={"file": ("rooms.xlsx", invalid_upload, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert response.status_code == 200
        assert response.json()["rows_failed"] == 1
        assert db.query(Room).count() == 1
        assert db.query(Room).filter_by(room_code="ROOM-A").one()
    finally:
        app.dependency_overrides.clear()
        db.close()
        engine.dispose()


def test_database_crud_and_dependency_blocking(tmp_path):
    db, engine = _route_db(tmp_path)
    client = _client_for(db)
    try:
        create_response = client.post(
            "/api/database/rooms",
            json={
                "room_code": "CRUD-01",
                "room_name": "Crud Room",
                "room_type": "classroom",
                "capacity": 24,
                "is_virtual": False,
                "campus_mode": "Physical",
                "recording_available": False,
            },
        )
        assert create_response.status_code == 200
        room_id = create_response.json()["id"]

        update_response = client.put(
            f"/api/database/rooms/{room_id}",
            json={"capacity": 36},
        )
        assert update_response.status_code == 200
        assert update_response.json()["capacity"] == 36

        delete_response = client.delete(f"/api/database/rooms/{room_id}")
        assert delete_response.status_code == 200

        used_staff = db.query(Staff).filter_by(staff_id="S001").one()
        blocked_response = client.delete(f"/api/database/staff/{used_staff.id}")
        assert blocked_response.status_code == 400
        assert "used by requirements" in blocked_response.json()["detail"][0]["message"]
    finally:
        app.dependency_overrides.clear()
        db.close()
        engine.dispose()


def test_schedule_generation_still_reads_core_data_after_split(tmp_path):
    data_dir = tmp_path / "data"
    create_db_and_seed(data_dir=data_dir, legacy_database_path=tmp_path / "missing.db")
    SessionLocal, engines = create_session_factory(data_dir)
    db = SessionLocal()
    try:
        result = ScheduleService().generate(db)
        assert result["solver_status"] in {"FEASIBLE", "OPTIMAL"}
        assert db.query(ScheduleRun).count() == 1
    finally:
        db.close()
        dispose_engines(engines)
