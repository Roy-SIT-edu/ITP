"""Tests for CP-SAT timetable solver behavior."""

from types import SimpleNamespace

import pytest
from app.models.room import Room
from app.models.schedule_run import ScheduleRun
from app.models.session import Session
from app.models.time_slot import TimeSlot
from app.services.schedule_service import ScheduleService, generation_timeout_seconds
from app.services.academic_calendar_service import AcademicCalendarService
from app.services.validation_service import ValidationService
from app.solver.cp_sat_solver import CpSatTimetableSolver


def test_solver_modes_configure_parallelism_and_seed():
    standard = CpSatTimetableSolver._configured_solver(max_seconds=30, fast_mode=False, reproducible=False)
    reproducible = CpSatTimetableSolver._configured_solver(max_seconds=30, fast_mode=False, reproducible=True)

    assert standard.parameters.num_search_workers == 8
    assert reproducible.parameters.num_search_workers == 1
    assert reproducible.parameters.random_seed == 42


def test_reproducible_mode_gets_a_longer_solver_budget():
    assert generation_timeout_seconds(False) == 30
    assert generation_timeout_seconds(True) == 300


def test_strict_and_relaxed_solves_share_one_total_budget(monkeypatch):
    solver = CpSatTimetableSolver()
    built = SimpleNamespace(no_candidate_reasons=[])
    solve_budgets = []
    clock = iter([0.0, 10.0, 25.0])

    monkeypatch.setattr("app.solver.cp_sat_solver.perf_counter", lambda: next(clock))
    monkeypatch.setattr(solver, "_has_known_fixed_hard_clash", lambda sessions: False)
    monkeypatch.setattr(solver.model_builder, "build", lambda *args, **kwargs: built)

    def fake_solve(_built, max_seconds, fast_mode, reproducible):
        solve_budgets.append(max_seconds)
        if len(solve_budgets) == 1:
            return {"solver_status": "INFEASIBLE", "assignments": [], "soft_score": 0, "message": "strict"}
        return {"solver_status": "FEASIBLE", "assignments": [], "soft_score": 0, "message": "relaxed"}

    monkeypatch.setattr(solver, "_solve_built_model", fake_solve)

    result = solver.solve([Session(id=1)], [], [], max_seconds=100)

    assert result["solver_status"] == "FEASIBLE"
    assert solve_budgets == [90.0, 75.0]


def test_solver_exception_marks_schedule_run_failed(db_session, monkeypatch):
    service = ScheduleService()
    monkeypatch.setattr(service.solver, "solve", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("boom")))

    with pytest.raises(RuntimeError, match="boom"):
        service.generate(db_session, academic_year="2025/26", trimester=3, fast_mode=True)

    run = db_session.query(ScheduleRun).one()
    assert run.status == "FAILED"
    assert run.solver_status == "ERROR"
    assert run.message == "Schedule generation failed: boom"


def test_persistence_exception_marks_schedule_run_failed(db_session, monkeypatch):
    service = ScheduleService()
    monkeypatch.setattr(
        service.solver,
        "solve",
        lambda *args, **kwargs: {
            "solver_status": "FEASIBLE",
            "assignments": [],
            "soft_score": 0,
            "message": "Schedule generated successfully",
        },
    )
    monkeypatch.setattr(
        service.lab_overlap_service,
        "resolve_run",
        lambda *args, **kwargs: {"excluded_session_count": 0, "detected_pair_count": 0, "excluded_session_ids": []},
    )
    monkeypatch.setattr(
        service.constraint_service,
        "check_and_store",
        lambda *args, **kwargs: {
            "hard_violation_count": 0,
            "soft_warning_count": 0,
            "weighted_soft_score": 0,
            "violations": [],
        },
    )
    monkeypatch.setattr(
        AcademicCalendarService,
        "sync_run_occurrences",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("occurrence failure")),
    )

    with pytest.raises(RuntimeError, match="occurrence failure"):
        service.generate(db_session, academic_year="2025/26", trimester=3, fast_mode=True)

    run = db_session.query(ScheduleRun).one()
    assert run.status == "FAILED"
    assert run.solver_status == "ERROR"
    assert run.message == "Schedule generation failed: occurrence failure"


def test_backend_restart_marks_running_schedule_as_interrupted(db_session):
    run = ScheduleRun(status="RUNNING", message="Solver started")
    db_session.add(run)
    db_session.commit()

    count = ScheduleService.fail_interrupted_runs(db_session)

    db_session.refresh(run)
    assert count == 1
    assert run.status == "FAILED"
    assert run.solver_status == "INTERRUPTED"
    assert "generate again" in run.message


def test_seeded_time_slots_end_by_6pm(db_session):
    slots = db_session.query(TimeSlot).all()

    assert slots
    assert max(slot.end_time for slot in slots) == "18:00"


def test_feasible_sample_data_returns_solution(db_session):
    result = CpSatTimetableSolver().solve(
        db_session.query(Session).all(),
        db_session.query(TimeSlot).all(),
        db_session.query(Room).all(),
        max_seconds=5,
    )

    assert result["solver_status"] in {"FEASIBLE", "OPTIMAL"}
    assert len(result["assignments"]) == db_session.query(Session).count()


def test_impossible_room_capacity_returns_infeasible(db_session):
    session = db_session.query(Session).filter_by(requirement_id="REQ-DEMO-001").one()
    session.exact_class_size = 5000

    result = CpSatTimetableSolver().solve(
        db_session.query(Session).all(),
        db_session.query(TimeSlot).all(),
        db_session.query(Room).all(),
        max_seconds=5,
    )

    assert result["solver_status"] == "INFEASIBLE"


def test_unavoidable_resource_clash_still_returns_reviewable_schedule(db_session):
    sessions = db_session.query(Session).order_by(Session.id).limit(2).all()
    for session in sessions:
        session.delivery_mode = "Face-to-face"
        session.venue_type_required = "classroom"
        session.exact_class_size = 20
        session.duration_minutes = 120

    slot = db_session.query(TimeSlot).filter_by(day="Monday", start_time="09:00", end_time="11:00", week_pattern="Weekly").one()
    room = db_session.query(Room).filter_by(room_code="SR-02").one()

    result = CpSatTimetableSolver().solve(sessions, [slot], [room], max_seconds=5)

    assert result["solver_status"] in {"FEASIBLE", "OPTIMAL"}
    assert len(result["assignments"]) == 2
    assert {assignment["room_id"] for assignment in result["assignments"]} == {room.id}
    assert {assignment["time_slot_id"] for assignment in result["assignments"]} == {slot.id}


def test_fixed_session_with_no_matching_slot_returns_validation_error(db_session):
    session = db_session.query(Session).first()
    session.scheduling_type = "Fixed"
    session.fixed_day = "Monday"
    session.fixed_start_time = "07:00"
    session.fixed_end_time = "08:00"

    validation = ValidationService().validate_latest(db_session)

    assert validation["is_valid"] is False
    assert any("No default time slot matches" in error["message"] for error in validation["errors"])


def test_fixed_session_after_6pm_returns_cutoff_validation_error(db_session):
    session = db_session.query(Session).first()
    session.scheduling_type = "Fixed"
    session.fixed_day = "Monday"
    session.fixed_start_time = "18:00"
    session.fixed_end_time = "19:00"

    validation = ValidationService().validate_latest(db_session)

    assert validation["is_valid"] is False
    assert any(error["field"] == "Fixed End Time" and "end by 18:00" in error["message"] for error in validation["errors"])


def test_fixed_staff_clash_is_reported_before_generation(db_session):
    sessions = db_session.query(Session).filter(Session.staff_id.isnot(None)).order_by(Session.id).limit(2).all()
    sessions[1].staff_id = sessions[0].staff_id
    for session in sessions:
        session.scheduling_type = "Fixed"
        session.fixed_day = "Monday"
        session.fixed_start_time = "09:00"
        session.fixed_end_time = "11:00"

    validation = ValidationService().validate_latest(db_session)

    assert validation["is_valid"] is False
    assert any(
        error["field"] == "Fixed Time"
        and "Staff" in error["message"]
        and set(error["conflict_session_ids"]) == {sessions[0].id, sessions[1].id}
        for error in validation["errors"]
    )


def test_fixed_student_group_clash_is_reported_before_generation(db_session):
    sessions = db_session.query(Session).order_by(Session.id).limit(2).all()
    sessions[1].student_group_id = sessions[0].student_group_id
    for session in sessions:
        session.scheduling_type = "Fixed"
        session.fixed_day = "Tuesday"
        session.fixed_start_time = "10:00"
        session.fixed_end_time = "12:00"

    validation = ValidationService().validate_latest(db_session)

    assert validation["is_valid"] is False
    assert any(
        error["field"] == "Fixed Time"
        and "Student group" in error["message"]
        and set(error["conflict_session_ids"]) == {sessions[0].id, sessions[1].id}
        for error in validation["errors"]
    )


def test_fixed_lab_to_lab_clashes_are_left_to_lab_overlap_resolver(db_session):
    sessions = db_session.query(Session).filter(Session.staff_id.isnot(None)).order_by(Session.id).limit(2).all()
    sessions[1].staff_id = sessions[0].staff_id
    sessions[1].student_group_id = sessions[0].student_group_id
    for session in sessions:
        session.is_lab_requirement = True
        session.scheduling_type = "Fixed"
        session.fixed_day = "Tuesday"
        session.fixed_start_time = "09:00"
        session.fixed_end_time = "11:00"
        session.week_pattern = "Weekly"

    errors = []
    ValidationService()._fixed_hard_clash_checks(db_session, sessions, errors)

    assert errors == []


def test_custom_even_week_session_uses_even_slot(db_session):
    session = db_session.query(Session).filter_by(requirement_id="REQ-DEMO-001").one()
    session.week_pattern = "Custom"
    session.custom_weeks = "2,4,6,8,10,12"

    result = CpSatTimetableSolver().solve(
        [session],
        db_session.query(TimeSlot).all(),
        db_session.query(Room).all(),
        max_seconds=5,
    )

    assert result["solver_status"] in {"FEASIBLE", "OPTIMAL"}
    assert result["assignments"][0]["week_pattern"] == "Even"
