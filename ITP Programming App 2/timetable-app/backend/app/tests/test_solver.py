from app.models.room import Room
from app.models.session import Session
from app.models.time_slot import TimeSlot
from app.services.scheduling_rules import candidate_slot_allowed
from app.services.validation_service import ValidationService
"""Tests for CP-SAT timetable solver behavior."""

from app.solver.cp_sat_solver import CpSatTimetableSolver


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


def test_fixed_session_with_no_matching_slot_returns_validation_error(db_session):
    session = db_session.query(Session).first()
    session.scheduling_type = "Fixed"
    session.fixed_day = "Monday"
    session.fixed_start_time = "07:00"
    session.fixed_end_time = "08:00"

    validation = ValidationService().validate_latest(db_session)

    assert validation["is_valid"] is False
    assert any("No default time slot matches" in error["message"] for error in validation["errors"])


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


def test_lunch_is_not_fixed_to_12_to_13(db_session):
    session = db_session.query(Session).filter_by(requirement_id="REQ-DEMO-001").one()
    slot = (
        db_session.query(TimeSlot)
        .filter_by(day="Monday", start_time="12:00", end_time="14:00", week_pattern="Weekly")
        .one()
    )

    assert candidate_slot_allowed(session, slot) is True


def test_fixed_session_can_use_12_to_14_when_11_to_12_is_free(db_session):
    session = db_session.query(Session).filter_by(requirement_id="REQ-DEMO-001").one()
    session.scheduling_type = "Fixed"
    session.fixed_day = "Monday"
    session.fixed_start_time = "12:00"
    session.fixed_end_time = "14:00"

    result = CpSatTimetableSolver().solve(
        [session],
        db_session.query(TimeSlot).all(),
        db_session.query(Room).all(),
        max_seconds=5,
    )

    assert result["solver_status"] in {"FEASIBLE", "OPTIMAL"}
    assert result["assignments"][0]["start_time"] == "12:00"
    assert result["assignments"][0]["end_time"] == "14:00"


def test_solver_requires_one_lunch_hour_between_11_and_14(db_session):
    sessions = db_session.query(Session).order_by(Session.id).limit(3).all()
    sessions[1].student_group_id = sessions[0].student_group_id
    sessions[2].student_group_id = sessions[0].student_group_id
    sessions[1].staff_id = sessions[0].staff_id
    sessions[2].staff_id = sessions[0].staff_id
    fixed_times = [("10:00", "12:00", 120), ("12:00", "13:00", 60), ("13:00", "15:00", 120)]
    for session, (start, end, duration) in zip(sessions, fixed_times):
        session.scheduling_type = "Fixed"
        session.fixed_day = "Monday"
        session.fixed_start_time = start
        session.fixed_end_time = end
        session.duration_minutes = duration
        session.week_pattern = "Weekly"
        session.delivery_mode = "Face-to-face"
        session.campus_mode = "Physical"
        session.venue_type_required = "classroom"
        session.exact_class_size = 30

    result = CpSatTimetableSolver().solve(
        sessions,
        db_session.query(TimeSlot).all(),
        db_session.query(Room).all(),
        max_seconds=5,
    )

    assert result["solver_status"] == "INFEASIBLE"


def test_solver_uses_active_rules_for_late_class_penalty(db_session):
    session = db_session.query(Session).filter_by(requirement_id="REQ-DEMO-001").one()
    session.scheduling_type = "Fixed"
    session.fixed_day = "Monday"
    session.fixed_start_time = "17:00"
    session.fixed_end_time = "18:00"
    session.duration_minutes = 60
    session.student_group_id = None
    session.delivery_mode = "Online"
    session.campus_mode = "Virtual"
    session.venue_type_required = "virtual"
    slot = (
        db_session.query(TimeSlot)
        .filter_by(day="Monday", start_time="17:00", end_time="18:00", week_pattern="Weekly")
        .one()
    )
    room = db_session.query(Room).filter_by(room_code="VIRTUAL-ROOM-1").one()

    active_result = CpSatTimetableSolver().solve(
        [session],
        [slot],
        [room],
        soft_constraint_weights={"CLASS_AFTER_1700": 11},
        max_seconds=5,
    )
    disabled_result = CpSatTimetableSolver().solve(
        [session],
        [slot],
        [room],
        soft_constraint_weights={"CLASS_AFTER_1700": 11},
        active_rules=[],
        max_seconds=5,
    )

    assert active_result["solver_status"] in {"FEASIBLE", "OPTIMAL"}
    assert active_result["soft_score"] == 11
    assert disabled_result["solver_status"] in {"FEASIBLE", "OPTIMAL"}
    assert disabled_result["soft_score"] == 0
