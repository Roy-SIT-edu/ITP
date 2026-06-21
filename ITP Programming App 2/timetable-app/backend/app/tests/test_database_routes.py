"""Tests for split database APIs, example files, and schedule compatibility."""

from io import BytesIO

import pandas as pd
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models  # noqa: F401
from app.database import Base, create_db_and_seed, create_session_factory, dispose_engines, get_db
from app.main import app
from app.models.module import Module
from app.models.programme import Programme
from app.models.room import Room
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
        assert db.query(Room).count() == 0
        assert db.query(Staff).count() == 0
    finally:
        db.close()
        dispose_engines(engines)


def test_raw_data_workbook_seeds_matching_reference_tables(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    raw_data_path = data_dir / "Raw Data.xlsx"
    with pd.ExcelWriter(raw_data_path) as writer:
        pd.DataFrame(
            [
                {
                    "Location Name": "E2-01-01-Lectorial 6",
                    "Location Description": "Lectorial 6 E2-01-01",
                    "Capacity": 158,
                    "Resource Type": "Lectorial",
                    "Recording": "Yes",
                }
            ]
        ).to_excel(writer, index=False, sheet_name="Campus Restrictions")
        pd.DataFrame([{"Module Code": "AAI1001", "Term": 2520, "Host Key": "AAI1001-2520-ICT-UGRD-PU"}]).to_excel(
            writer, index=False, sheet_name="Module Code"
        )
        pd.DataFrame([{"Name": "AFIFAH BINTE ABDUL RAHMAN .", "Host Key": "A102199"}]).to_excel(
            writer, index=False, sheet_name="Staff Information"
        )
        pd.DataFrame([{"Module": "UCS1001", "Year": 1, "Programmes": "ACC, ASE & DSC"}]).to_excel(
            writer, index=False, sheet_name="Common Modules"
        )

    create_db_and_seed(data_dir=data_dir, legacy_database_path=tmp_path / "missing.db")
    SessionLocal, engines = create_session_factory(data_dir)
    db = SessionLocal()
    try:
        room = db.query(Room).filter_by(room_code="E2-01-01").one()
        assert room.room_name == "Lectorial 6"
        assert room.recording_available is True
        assert db.query(Module).filter_by(module_code="AAI1001").one().module_host_key == "AAI1001-2520-ICT-UGRD-PU"
        assert db.query(Staff).filter_by(staff_id="A102199").one().staff_name == "AFIFAH BINTE ABDUL RAHMAN"
        assert {item.code for item in db.query(Programme).all()} >= {"ACC", "ASE", "DSC"}
        assert db.query(Programme).filter_by(code="DSC").one().name == "Digital Supply Chain"
        assert db.query(Programme).filter_by(code="DSC").one().years == 3
    finally:
        db.close()
        dispose_engines(engines)


def test_database_current_workbook_contains_live_data(tmp_path):
    db, engine = _route_db(tmp_path)
    client = _client_for(db)
    try:
        response = client.get("/api/database/rooms/current.xlsx")
    finally:
        app.dependency_overrides.clear()
        db.close()
        engine.dispose()

    assert response.status_code == 200
    assert 'filename=rooms-current-input.xlsx' in response.headers["content-disposition"]
    frame = pd.read_excel(BytesIO(response.content))
    assert "room_code" in frame.columns
    assert "SR-01" in set(frame["room_code"])


def test_staff_database_hides_duplicate_host_key(tmp_path):
    db, engine = _route_db(tmp_path)
    client = _client_for(db)
    try:
        types_response = client.get("/api/database/types")
        staff_type = next(item for item in types_response.json() if item["id"] == "staff")
        assert [column["key"] for column in staff_type["columns"]] == ["id", "staff_id", "staff_name"]

        rows_response = client.get("/api/database/staff")
        assert "staff_host_key" not in rows_response.json()[0]

        workbook_response = client.get("/api/database/staff/current.xlsx")
    finally:
        app.dependency_overrides.clear()
        db.close()
        engine.dispose()

    frame = pd.read_excel(BytesIO(workbook_response.content))
    assert "staff_host_key" not in frame.columns


def test_programme_database_uses_years_not_cluster(tmp_path):
    db, engine = _route_db(tmp_path)
    client = _client_for(db)
    try:
        types_response = client.get("/api/database/types")
        programme_type = next(item for item in types_response.json() if item["id"] == "programmes")
        assert [column["key"] for column in programme_type["columns"]] == ["id", "code", "name", "years"]

        rows_response = client.get("/api/database/programmes")
        dsc = next(item for item in rows_response.json() if item["code"] == "DSC")
        assert dsc["years"] == 3
        assert "cluster" not in dsc

        workbook_response = client.get("/api/database/programmes/current.xlsx")
    finally:
        app.dependency_overrides.clear()
        db.close()
        engine.dispose()

    frame = pd.read_excel(BytesIO(workbook_response.content))
    assert "years" in frame.columns
    assert "cluster" not in frame.columns


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


def test_replace_upload_assigns_ids_by_alphabetical_order(tmp_path):
    db, engine = _route_db(tmp_path)
    client = _client_for(db)
    try:
        upload = _workbook(
            [
                {
                    "room_code": "ROOM-C",
                    "room_name": "Room C",
                    "room_type": "classroom",
                    "capacity": 30,
                    "is_virtual": False,
                    "campus_mode": "Physical",
                    "recording_available": False,
                },
                {
                    "room_code": "ROOM-A",
                    "room_name": "Room A",
                    "room_type": "classroom",
                    "capacity": 30,
                    "is_virtual": False,
                    "campus_mode": "Physical",
                    "recording_available": False,
                },
                {
                    "room_code": "ROOM-B",
                    "room_name": "Room B",
                    "room_type": "classroom",
                    "capacity": 30,
                    "is_virtual": False,
                    "campus_mode": "Physical",
                    "recording_available": False,
                },
            ]
        )
        response = client.post(
            "/api/database/rooms/upload",
            files={"file": ("rooms.xlsx", upload, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert response.status_code == 200

        rows_response = client.get("/api/database/rooms")
        rows = rows_response.json()
        assert [(row["id"], row["room_code"]) for row in rows] == [
            (1, "ROOM-A"),
            (2, "ROOM-B"),
            (3, "ROOM-C"),
        ]
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
        assert result["solver_status"] == "INFEASIBLE"
        assert result["message"] == "No sessions are available to schedule."
        assert db.query(ScheduleRun).count() == 1
    finally:
        db.close()
        dispose_engines(engines)
