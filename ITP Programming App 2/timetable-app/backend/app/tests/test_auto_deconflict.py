"""Regression tests for safe auto-deconflict schedule derivation."""

from copy import deepcopy

import pytest
from app.database import get_db
from app.main import app
from app.models.room import Room
from app.models.schedule_run import ScheduleRun
from app.models.scheduled_session import ScheduledSession
from app.models.session import Session
from app.models.time_slot import TimeSlot
from app.services.auto_deconflict_service import AutoDeconflictService
from app.services.constraint_service import ConstraintService
from app.services.schedule_service import ScheduleService
from fastapi.testclient import TestClient


def _slot(db_session, day="Monday", start="09:00"):
    return db_session.query(TimeSlot).filter_by(day=day, start_time=start, week_pattern="Weekly").first()


def _room(db_session, code="SR-01"):
    return db_session.query(Room).filter_by(room_code=code).one()


def _prepare_sessions(db_session, *, fixed=False, lab_first=False):
    sessions = db_session.query(Session).order_by(Session.id).limit(2).all()
    group_ids = [item.student_group_id for item in db_session.query(Session).all() if item.student_group_id is not None]
    for index, session in enumerate(sessions):
        session.delivery_mode = "Face-to-face"
        session.venue_type_required = "classroom"
        session.exact_class_size = 20
        session.duration_minutes = 120
        session.week_pattern = "Weekly"
        session.required_room_codes = None
        session.required_student_group_codes = None
        session.priority = "Normal"
        session.avoid_days = None
        session.scheduling_type = "Fixed" if fixed else "Flexible"
        session.is_lab_requirement = lab_first and index == 0
        if fixed or session.is_lab_requirement:
            session.fixed_day = "Monday"
            session.fixed_start_time = "09:00"
            session.fixed_end_time = "11:00"
        else:
            session.fixed_day = None
            session.fixed_start_time = None
            session.fixed_end_time = None
    if len(set(group_ids)) > 1:
        sessions[0].student_group_id = group_ids[0]
        sessions[1].student_group_id = next(item for item in group_ids if item != group_ids[0])
    if sessions[0].staff_id == sessions[1].staff_id:
        sessions[1].staff_id = None
    db_session.flush()
    return sessions


def _create_conflicting_run(db_session, sessions, *, room=None, slot=None):
    room = room or _room(db_session)
    slot = slot or _slot(db_session)
    run = ScheduleRun(status="COMPLETED_WITH_CONFLICTS", solver_status="FEASIBLE", hard_violation_count=1)
    db_session.add(run)
    db_session.flush()
    for session in sessions:
        db_session.add(
            ScheduledSession(
                schedule_run_id=run.id,
                session_id=session.id,
                room_id=room.id,
                time_slot_id=slot.id,
                staff_id=session.staff_id,
                day=slot.day,
                start_time=slot.start_time,
                end_time=slot.end_time,
                week_pattern=slot.week_pattern,
            )
        )
    db_session.commit()
    return run


def _source_snapshot(db_session, run, sessions):
    return {
        "requirements": {
            session.id: (
                session.scheduling_type,
                session.fixed_day,
                session.fixed_start_time,
                session.fixed_end_time,
                session.is_lab_requirement,
            )
            for session in sessions
        },
        "assignments": [
            (item.session_id, item.time_slot_id, item.room_id, item.day, item.start_time, item.end_time)
            for item in db_session.query(ScheduledSession).filter_by(schedule_run_id=run.id).order_by(ScheduledSession.session_id).all()
        ],
    }


def test_auto_deconflict_moves_flexible_session_and_preserves_source(db_session):
    sessions = _prepare_sessions(db_session)
    run = _create_conflicting_run(db_session, sessions)
    before = deepcopy(_source_snapshot(db_session, run, sessions))

    result = AutoDeconflictService().run(db_session, run.id)

    assert result["source_schedule_run_id"] == run.id
    assert result["moved_session_count"] == 1
    assert result["hard_violation_count"] == 0
    assert result["solver_status"] == "FEASIBLE"
    assert result["timed_out"] is False
    assert _source_snapshot(db_session, run, sessions) == before
    assert not [item for item in ConstraintService().check_schedule(db_session, result["schedule_run_id"]) if item["severity"] == "HARD"]


def test_auto_deconflict_moves_uploaded_fixed_sessions_without_rewriting_source(db_session):
    sessions = _prepare_sessions(db_session, fixed=True)
    run = _create_conflicting_run(db_session, sessions)
    before = deepcopy(_source_snapshot(db_session, run, sessions))

    result = AutoDeconflictService().run(db_session, run.id)

    assert result["moved_session_count"] == 1
    assert result["hard_violation_count"] == 0
    assert result["unresolved_fixed_session_ids"] == []
    assert result["unresolved_lab_session_ids"] == []
    assert _source_snapshot(db_session, run, sessions) == before


def test_first_run_shows_excel_fixed_conflicts_before_auto_optimization(db_session):
    sessions = db_session.query(Session).order_by(Session.id).limit(2).all()
    for session in sessions:
        session.scheduling_type = "Fixed"
        session.fixed_day = "Monday"
        session.fixed_start_time = "09:00"
        session.fixed_end_time = "11:00"
    db_session.commit()

    initial = ScheduleService().generate(db_session, timeout=10, reproducible=True)
    initial_assignments = (
        db_session.query(ScheduledSession)
        .filter_by(schedule_run_id=initial["schedule_run_id"])
        .filter(ScheduledSession.session_id.in_([item.id for item in sessions]))
        .all()
    )

    assert initial["hard_violation_count"] > 0
    assert {(item.day, item.start_time, item.end_time) for item in initial_assignments} == {("Monday", "09:00", "11:00")}

    optimized = ScheduleService().auto_deconflict(db_session, initial["schedule_run_id"], timeout=30)

    assert optimized["moved_session_count"] >= 1
    assert optimized["hard_violation_count"] == 0
    assert all(item.scheduling_type == "Fixed" for item in sessions)
    assert all(item.fixed_day == "Monday" for item in sessions)


def test_auto_deconflict_keeps_fixed_lab_and_moves_normal_session(db_session):
    sessions = _prepare_sessions(db_session, lab_first=True)
    run = _create_conflicting_run(db_session, sessions)
    before = deepcopy(_source_snapshot(db_session, run, sessions))

    result = AutoDeconflictService().run(db_session, run.id)

    assert result["moved_session_count"] == 1
    assert result["hard_violation_count"] == 0
    assert _source_snapshot(db_session, run, sessions) == before
    derived_lab = (
        db_session.query(ScheduledSession)
        .filter_by(
            schedule_run_id=result["schedule_run_id"],
            session_id=sessions[0].id,
        )
        .one()
    )
    source_lab = db_session.query(ScheduledSession).filter_by(schedule_run_id=run.id, session_id=sessions[0].id).one()
    assert (derived_lab.time_slot_id, derived_lab.room_id) == (source_lab.time_slot_id, source_lab.room_id)


def test_lab_to_lab_overlap_remains_exempt(db_session):
    sessions = _prepare_sessions(db_session, fixed=True)
    for session in sessions:
        session.is_lab_requirement = True
    run = _create_conflicting_run(db_session, sessions)

    hard = [item for item in ConstraintService().check_schedule(db_session, run.id) if item["severity"] == "HARD"]

    assert hard == []


def test_auto_deconflict_handles_capacity_mismatch(db_session):
    session = _prepare_sessions(db_session)[0]
    session.exact_class_size = 80
    small_room = min(
        (room for room in db_session.query(Room).all() if not room.is_virtual),
        key=lambda room: room.capacity,
    )
    run = _create_conflicting_run(db_session, [session], room=small_room)
    assert any(item["constraint_code"] == "ROOM_CAPACITY_MISMATCH" for item in ConstraintService().check_schedule(db_session, run.id))

    result = AutoDeconflictService().run(db_session, run.id)

    assert result["moved_session_count"] == 1
    assert result["hard_violation_count"] == 0


def test_auto_deconflict_handles_delivery_mismatch(db_session):
    session = _prepare_sessions(db_session)[0]
    session.delivery_mode = "Online"
    session.campus_mode = "Virtual"
    session.venue_type_required = "virtual"
    physical_room = db_session.query(Room).filter(Room.is_virtual.is_(False)).order_by(Room.id).first()
    db_session.flush()
    run = _create_conflicting_run(db_session, [session], room=physical_room)
    assert any(item["constraint_code"] == "DELIVERY_ROOM_MISMATCH" for item in ConstraintService().check_schedule(db_session, run.id))

    result = AutoDeconflictService().run(db_session, run.id)
    moved = db_session.query(ScheduledSession).filter_by(schedule_run_id=result["schedule_run_id"]).one()

    assert result["hard_violation_count"] == 0
    assert moved.room.is_virtual is True


def test_auto_deconflict_handles_required_room_mismatch(db_session):
    session = _prepare_sessions(db_session)[0]
    allowed_room = (
        db_session.query(Room)
        .filter(Room.is_virtual.is_(False), Room.capacity >= session.exact_class_size)
        .order_by(Room.id.desc())
        .first()
    )
    wrong_room = (
        db_session.query(Room)
        .filter(Room.is_virtual.is_(False), Room.id != allowed_room.id, Room.capacity >= session.exact_class_size)
        .order_by(Room.id)
        .first()
    )
    session.required_room_codes = allowed_room.room_code
    db_session.flush()
    run = _create_conflicting_run(db_session, [session], room=wrong_room)
    assert any(item["constraint_code"] == "REQUIRED_ROOM_MISMATCH" for item in ConstraintService().check_schedule(db_session, run.id))

    result = AutoDeconflictService().run(db_session, run.id)
    moved = db_session.query(ScheduledSession).filter_by(schedule_run_id=result["schedule_run_id"]).one()

    assert result["hard_violation_count"] == 0
    assert moved.room_id == allowed_room.id


def test_auto_deconflict_is_deterministic(db_session):
    sessions = _prepare_sessions(db_session)
    run = _create_conflicting_run(db_session, sessions)

    first = AutoDeconflictService().run(db_session, run.id)
    second = AutoDeconflictService().run(db_session, run.id)

    def placements(run_id):
        return [
            (item.session_id, item.time_slot_id, item.room_id)
            for item in db_session.query(ScheduledSession).filter_by(schedule_run_id=run_id).order_by(ScheduledSession.session_id).all()
        ]

    assert placements(first["schedule_run_id"]) == placements(second["schedule_run_id"])


def test_auto_deconflict_commits_safe_best_effort_on_timeout(db_session):
    sessions = _prepare_sessions(db_session)
    run = _create_conflicting_run(db_session, sessions)

    result = AutoDeconflictService().run(db_session, run.id, timeout=0.0)

    assert result["timed_out"] is True
    assert result["moved_session_count"] == 0
    assert result["hard_violation_count"] > 0


def test_auto_deconflict_rolls_back_failed_derived_run(db_session, monkeypatch):
    sessions = _prepare_sessions(db_session)
    run = _create_conflicting_run(db_session, sessions)
    count_before = db_session.query(ScheduleRun).count()
    service = AutoDeconflictService()

    def fail(*args, **kwargs):
        raise RuntimeError("forced failure")

    monkeypatch.setattr(service.constraint_service, "check_and_store", fail)

    with pytest.raises(RuntimeError, match="forced failure"):
        service.run(db_session, run.id)

    assert db_session.query(ScheduleRun).count() == count_before


def test_auto_deconflict_route_statuses_and_result(db_session):
    sessions = _prepare_sessions(db_session)
    run = _create_conflicting_run(db_session, sessions)

    def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    try:
        client = TestClient(app)
        missing = client.post("/api/schedules/999999/auto-deconflict")
        result = client.post(f"/api/schedules/{run.id}/auto-deconflict?timeout_seconds=30")
        clean_run_id = result.json()["schedule_run_id"]
        clean = client.post(f"/api/schedules/{clean_run_id}/auto-deconflict")
    finally:
        app.dependency_overrides.clear()

    assert missing.status_code == 404
    assert result.status_code == 200
    assert result.json()["source_schedule_run_id"] == run.id
    assert clean.status_code == 409


@pytest.mark.parametrize("status", ["RUNNING", "FAILED"])
def test_auto_deconflict_route_rejects_incomplete_runs(db_session, status):
    run = ScheduleRun(status=status, solver_status="UNKNOWN", hard_violation_count=1)
    db_session.add(run)
    db_session.commit()

    def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    try:
        response = TestClient(app).post(f"/api/schedules/{run.id}/auto-deconflict")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 409


def test_auto_deconflict_route_rejects_empty_run_and_invalid_timeout(db_session):
    empty_run = ScheduleRun(status="COMPLETED_WITH_CONFLICTS", solver_status="FEASIBLE", hard_violation_count=1)
    db_session.add(empty_run)
    db_session.commit()

    def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    try:
        client = TestClient(app)
        empty = client.post(f"/api/schedules/{empty_run.id}/auto-deconflict")
        too_short = client.post(f"/api/schedules/{empty_run.id}/auto-deconflict?timeout_seconds=0")
        too_long = client.post(f"/api/schedules/{empty_run.id}/auto-deconflict?timeout_seconds=121")
    finally:
        app.dependency_overrides.clear()

    assert empty.status_code == 409
    assert too_short.status_code == 422
    assert too_long.status_code == 422
