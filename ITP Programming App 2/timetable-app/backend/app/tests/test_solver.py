from app.models.room import Room
from app.models.session import Session
from app.models.time_slot import TimeSlot
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
