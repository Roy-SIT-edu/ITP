"""Tests for split database APIs, example files, and schedule compatibility."""

from io import BytesIO

import pandas as pd
from app import models  # noqa: F401
from app.database import Base, create_db_and_seed, create_session_factory, dispose_engines, get_db
from app.main import app
from app.models.programme import Programme
from app.models.room import Room
from app.models.schedule_run import ScheduleRun
from app.models.scheduled_session import ScheduledSession
from app.models.session import Session
from app.models.staff import Staff
from app.models.student_group import StudentGroup
from app.models.time_slot import TimeSlot
from app.services.schedule_service import ScheduleService
from app.services.seed_service import seed_reference_data, seed_sample_sessions
from app.services.student_group_service import normalize_student_group_ids
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


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


def test_timeslot_api_hides_slots_ending_after_6pm(tmp_path):
    db, engine = _route_db(tmp_path)
    db.add(
        TimeSlot(
            day="Monday",
            start_time="18:00",
            end_time="19:00",
            duration_minutes=60,
            week_pattern="Weekly",
        )
    )
    db.commit()
    client = _client_for(db)
    try:
        response = client.get("/api/timeslots")
        assert response.status_code == 200
        assert response.json()
        assert max(item["end_time"] for item in response.json()) == "18:00"
    finally:
        app.dependency_overrides.clear()
        db.close()
        engine.dispose()


def test_split_database_files_are_created_and_seeded(tmp_path):
    data_dir = tmp_path / "data"
    create_db_and_seed(data_dir=data_dir, legacy_database_path=tmp_path / "missing.db")

    assert sorted(path.name for path in data_dir.glob("*.db")) == [
        "calendar.db",
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
        pd.DataFrame([{"Module Code": "AAI1001", "Term": 2520}]).to_excel(writer, index=False, sheet_name="Module Code")
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
        assert db.query(Staff).filter_by(staff_id="A102199").one().staff_name == "AFIFAH BINTE ABDUL RAHMAN"
        assert {item.code for item in db.query(Programme).all()} >= {"ACC", "ASE", "DSC"}
        assert db.query(Programme).filter_by(code="DSC").one().name == "Digital Supply Chain"
        assert db.query(Programme).filter_by(code="DSC").one().years == 3
        dsc = db.query(Programme).filter_by(code="DSC").one()
        dsc_groups = db.query(StudentGroup).filter_by(programme_id=dsc.id).order_by(StudentGroup.year, StudentGroup.group_code).all()
        assert [(item.group_code, item.year, item.size) for item in dsc_groups] == [
            ("DSC Y1 P1", 1, 40),
            ("DSC Y1 P2", 1, 40),
            ("DSC Y2 P1", 2, 40),
            ("DSC Y2 P2", 2, 40),
            ("DSC Y3 P1", 3, 40),
            ("DSC Y3 P2", 3, 40),
        ]
        group_ids = [item.id for item in db.query(StudentGroup).order_by(StudentGroup.id).all()]
        assert group_ids == list(range(1, len(group_ids) + 1))
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
    assert "filename=rooms-current-input.xlsx" in response.headers["content-disposition"]
    frame = pd.read_excel(BytesIO(response.content))
    assert "room_code" in frame.columns
    assert "SR-01" in set(frame["room_code"])


def test_staff_database_uses_staff_id_without_host_key_column(tmp_path):
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


def test_module_database_has_no_host_key_column(tmp_path):
    db, engine = _route_db(tmp_path)
    client = _client_for(db)
    try:
        types_response = client.get("/api/database/types")
        module_type = next(item for item in types_response.json() if item["id"] == "modules")
        assert [column["key"] for column in module_type["columns"]] == ["id", "module_code", "module_title", "term"]

        rows_response = client.get("/api/database/modules")
        assert "module_host_key" not in rows_response.json()[0]

        workbook_response = client.get("/api/database/modules/current.xlsx")
    finally:
        app.dependency_overrides.clear()
        db.close()
        engine.dispose()

    frame = pd.read_excel(BytesIO(workbook_response.content))
    assert "module_host_key" not in frame.columns


def test_database_metadata_exposes_controls_and_rejects_bad_values(tmp_path):
    db, engine = _route_db(tmp_path)
    client = _client_for(db)
    try:
        types_response = client.get("/api/database/types")
        rooms_type = next(item for item in types_response.json() if item["id"] == "rooms")
        assert "campus_mode" not in [column["key"] for column in rooms_type["columns"]]
        room_type = next(column for column in rooms_type["columns"] if column["key"] == "room_type")
        capacity = next(column for column in rooms_type["columns"] if column["key"] == "capacity")
        recording = next(column for column in rooms_type["columns"] if column["key"] == "recording_available")
        assert "Seminar Room" in room_type["options"]
        assert capacity["min_value"] == 1
        assert capacity["max_value"] == 9999
        assert recording["kind"] == "boolean"

        bad_room_type = client.post(
            "/api/database/rooms",
            json={
                "room_code": "BAD-TYPE-01",
                "room_name": "Bad Type Room",
                "room_type": "Anything Goes",
                "capacity": 40,
                "is_virtual": False,
                "campus_mode": "Physical",
                "recording_available": False,
            },
        )
        assert bad_room_type.status_code == 400
        assert "Room Type must be one of" in bad_room_type.json()["detail"]

        bad_capacity = client.post(
            "/api/database/rooms",
            json={
                "room_code": "BAD-CAP-01",
                "room_name": "Bad Capacity Room",
                "room_type": "Seminar Room",
                "capacity": 0,
                "is_virtual": False,
                "campus_mode": "Physical",
                "recording_available": False,
            },
        )
        assert bad_capacity.status_code == 400
        assert "Capacity must be at least 1" in bad_capacity.json()["detail"]

        workbook_response = client.get("/api/database/rooms/current.xlsx")
    finally:
        app.dependency_overrides.clear()
        db.close()
        engine.dispose()

    frame = pd.read_excel(BytesIO(workbook_response.content))
    assert "campus_mode" not in frame.columns


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


def test_student_group_database_is_admin_editable(tmp_path):
    db, engine = _route_db(tmp_path)
    client = _client_for(db)
    try:
        types_response = client.get("/api/database/types")
        group_type = next(item for item in types_response.json() if item["id"] == "student-groups")
        assert [column["key"] for column in group_type["columns"]] == ["id", "programme", "year", "partition", "size"]

        create_response = client.post(
            "/api/database/student-groups",
            json={"programme": "DSC", "year": 1},
        )
        assert create_response.status_code == 200
        assert create_response.json()["group_code"] == "DSC Y1 P3"
        assert create_response.json()["programme"] == "DSC"
        assert create_response.json()["partition"] == 3
        assert create_response.json()["size"] == 40

        workbook_response = client.get("/api/database/student-groups/current.xlsx")
    finally:
        app.dependency_overrides.clear()
        db.close()
        engine.dispose()

    frame = pd.read_excel(BytesIO(workbook_response.content))
    assert "group_code" not in frame.columns
    assert "partition" in frame.columns


def test_student_group_id_normalization_remaps_requirements(tmp_path):
    db, engine = _route_db(tmp_path)
    try:
        target_group = db.query(StudentGroup).filter_by(group_code="DSC Y1 P1").one()
        session = db.query(Session).first()
        session.student_group_id = target_group.id
        old_target_id = target_group.id

        removable_group = db.query(StudentGroup).filter(StudentGroup.id != old_target_id).order_by(StudentGroup.id).first()
        db.delete(removable_group)
        db.flush()

        id_map = normalize_student_group_ids(db)
        db.commit()
        db.refresh(session)

        assert session.student_group_id == id_map[old_target_id]
        assert db.query(StudentGroup).filter_by(id=session.student_group_id).one().group_code == "DSC Y1 P1"
    finally:
        db.close()
        engine.dispose()


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
        result = ScheduleService().generate(db, academic_year="2025/26", trimester=3)
        assert result["solver_status"] == "INFEASIBLE"
        assert result["message"] == "No sessions are available to schedule."
        assert result["soft_score"] == 0
        assert result["quality"]["label"] == "No Schedule"
        assert db.query(ScheduleRun).count() == 1
    finally:
        db.close()
        dispose_engines(engines)


def test_dashboard_reports_latest_scheduled_coverage(tmp_path):
    db, engine = _route_db(tmp_path)
    client = _client_for(db)
    try:
        generation = client.post(
            "/api/schedules/generate?mode=reproducible",
            json={"academic_year": "2025/26", "trimester": 3},
        )
        assert generation.status_code == 200
        assert generation.json()["generation_mode"] == "reproducible"
        assert generation.json()["solver_timeout_seconds"] == 300

        response = client.get("/api/dashboard")
        assert response.status_code == 200
        payload = response.json()
        run_id = payload["latest_schedule"]["id"]
        expected = db.query(ScheduledSession).filter_by(schedule_run_id=run_id).count()
        assert payload["latest_schedule"]["scheduled_count"] == expected
    finally:
        app.dependency_overrides.clear()
        db.close()
        engine.dispose()
