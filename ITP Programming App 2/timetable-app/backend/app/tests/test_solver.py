"""Tests for CP-SAT timetable solver behavior."""

from app.models.room import Room
from app.models.schedule_run import ScheduleRun
from app.models.scheduled_session import ScheduledSession
from app.models.session import Session
from app.models.time_slot import TimeSlot
<<<<<<< Updated upstream
=======
from app.services.constraint_service import ConstraintService
from app.services.schedule_service import generation_timeout_seconds
>>>>>>> Stashed changes
from app.services.validation_service import ValidationService
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


<<<<<<< Updated upstream
def test_fixed_session_with_no_matching_slot_returns_validation_error(db_session):
=======
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


def test_non_lab_fixed_label_requires_a_matching_initial_slot(db_session):
>>>>>>> Stashed changes
    session = db_session.query(Session).first()
    session.scheduling_type = "Fixed"
    session.fixed_day = "Monday"
    session.fixed_start_time = "07:00"
    session.fixed_end_time = "08:00"

    validation = ValidationService().validate_latest(db_session)

    assert any("No default time slot matches" in error["message"] for error in validation["errors"])


def test_initial_generation_honors_uploaded_fixed_timing(db_session):
    session = db_session.query(Session).filter_by(requirement_id="REQ-DEMO-001").one()
    session.scheduling_type = "Fixed"
    session.fixed_day = "Tuesday"
    session.fixed_start_time = "10:00"
    session.fixed_end_time = "12:00"

    result = CpSatTimetableSolver().solve(
        [session],
        db_session.query(TimeSlot).all(),
        db_session.query(Room).all(),
        max_seconds=5,
    )

    assert result["solver_status"] in {"FEASIBLE", "OPTIMAL"}
    assert len(result["assignments"]) == 1
    assignment = result["assignments"][0]
    assert (assignment["day"], assignment["start_time"], assignment["end_time"]) == (
        "Tuesday",
        "10:00",
        "12:00",
    )


def test_initial_generation_honors_complete_timing_with_legacy_flexible_type(db_session):
    session = db_session.query(Session).filter_by(requirement_id="REQ-DEMO-001").one()
    session.scheduling_type = "Flexible"
    session.fixed_day = "Tuesday"
    session.fixed_start_time = "10:00"
    session.fixed_end_time = "12:00"

    result = CpSatTimetableSolver().solve(
        [session],
        db_session.query(TimeSlot).all(),
        db_session.query(Room).all(),
        max_seconds=5,
    )

    assert result["solver_status"] in {"FEASIBLE", "OPTIMAL"}
    assignment = result["assignments"][0]
    assert (assignment["day"], assignment["start_time"], assignment["end_time"]) == (
        "Tuesday",
        "10:00",
        "12:00",
    )


def test_conflicting_uploaded_fixed_timings_are_returned_for_admin_review(db_session):
    sessions = db_session.query(Session).filter(Session.staff_id.isnot(None)).order_by(Session.id).limit(2).all()
    sessions[1].staff_id = sessions[0].staff_id
    for session in sessions:
        session.scheduling_type = "Fixed"
        session.fixed_day = "Monday"
        session.fixed_start_time = "09:00"
        session.fixed_end_time = "11:00"
        session.delivery_mode = "Face-to-face"
        session.venue_type_required = "classroom"
        session.exact_class_size = 20
        session.duration_minutes = 120
        session.week_pattern = "Weekly"

    result = CpSatTimetableSolver().solve(
        sessions,
        db_session.query(TimeSlot).all(),
        db_session.query(Room).all(),
        max_seconds=5,
    )

    assert result["solver_status"] in {"FEASIBLE", "OPTIMAL"}
    assert {(item["day"], item["start_time"], item["end_time"]) for item in result["assignments"]} == {("Monday", "09:00", "11:00")}

    run = ScheduleRun(status="COMPLETED_WITH_CONFLICTS", solver_status=result["solver_status"])
    db_session.add(run)
    db_session.flush()
    for assignment in result["assignments"]:
        db_session.add(ScheduledSession(schedule_run_id=run.id, **assignment))
    db_session.flush()

    hard = [item for item in ConstraintService().check_schedule(db_session, run.id) if item["severity"] == "HARD"]
    assert any(item["constraint_code"] == "STAFF_DOUBLE_BOOKING" for item in hard)


def test_non_lab_fixed_staff_overlap_is_not_a_pre_generation_clash(db_session):
    sessions = db_session.query(Session).filter(Session.staff_id.isnot(None)).order_by(Session.id).limit(2).all()
    sessions[1].staff_id = sessions[0].staff_id
    for session in sessions:
        session.scheduling_type = "Fixed"
        session.fixed_day = "Monday"
        session.fixed_start_time = "09:00"
        session.fixed_end_time = "11:00"

    validation = ValidationService().validate_latest(db_session)

    assert not any(error["field"] == "Fixed Time" and "Staff" in error["message"] for error in validation["errors"])


def test_non_lab_fixed_group_overlap_is_not_a_pre_generation_clash(db_session):
    sessions = db_session.query(Session).order_by(Session.id).limit(2).all()
    sessions[1].student_group_id = sessions[0].student_group_id
    for session in sessions:
        session.scheduling_type = "Fixed"
        session.fixed_day = "Tuesday"
        session.fixed_start_time = "10:00"
        session.fixed_end_time = "12:00"

    validation = ValidationService().validate_latest(db_session)

    assert not any(error["field"] == "Fixed Time" and "Student group" in error["message"] for error in validation["errors"])


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
