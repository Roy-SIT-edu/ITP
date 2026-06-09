"""Tests for post-generation constraint detection."""

import json

from app.models.constraint_violation import ConstraintViolation
from app.models.room import Room
from app.models.rule import Rule
from app.models.schedule_run import ScheduleRun
from app.models.scheduled_session import ScheduledSession
from app.models.session import Session
from app.models.time_slot import TimeSlot
from app.services.constraint_service import ConstraintService
from app.services.resolution_service import ResolutionService


def _slot(db_session):
    return (
        db_session.query(TimeSlot)
        .filter_by(day="Monday", start_time="09:00", end_time="11:00", week_pattern="Weekly")
        .one()
    )


def _slot_at(db_session, start, end):
    return (
        db_session.query(TimeSlot)
        .filter_by(day="Monday", start_time=start, end_time=end, week_pattern="Weekly")
        .one()
    )


def _room(db_session, code):
    return db_session.query(Room).filter_by(room_code=code).one()


def _create_run(db_session, entries):
    run = ScheduleRun(status="COMPLETED", solver_status="TEST")
    db_session.add(run)
    db_session.flush()
    for session, room, slot in entries:
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
                week_pattern=session.week_pattern or slot.week_pattern,
            )
        )
    db_session.flush()
    return run


def test_room_double_booking_detected(db_session):
    sessions = db_session.query(Session).order_by(Session.id).limit(2).all()
    slot = _slot(db_session)
    room = _room(db_session, "SR-02")
    run = _create_run(db_session, [(sessions[0], room, slot), (sessions[1], room, slot)])

    violations = ConstraintService().check_schedule(db_session, run.id)

    assert any(item["constraint_code"] == "ROOM_DOUBLE_BOOKING" for item in violations)


def test_staff_double_booking_detected(db_session):
    sessions = db_session.query(Session).filter(Session.staff_id.isnot(None)).order_by(Session.id).limit(2).all()
    sessions[1].staff_id = sessions[0].staff_id
    slot = _slot(db_session)
    run = _create_run(db_session, [(sessions[0], _room(db_session, "SR-01"), slot), (sessions[1], _room(db_session, "SR-02"), slot)])

    violations = ConstraintService().check_schedule(db_session, run.id)

    assert any(item["constraint_code"] == "STAFF_DOUBLE_BOOKING" for item in violations)


def test_student_group_double_booking_detected(db_session):
    sessions = db_session.query(Session).order_by(Session.id).limit(2).all()
    sessions[1].student_group_id = sessions[0].student_group_id
    slot = _slot(db_session)
    run = _create_run(db_session, [(sessions[0], _room(db_session, "SR-01"), slot), (sessions[1], _room(db_session, "SR-02"), slot)])

    violations = ConstraintService().check_schedule(db_session, run.id)

    assert any(item["constraint_code"] == "STUDENT_GROUP_DOUBLE_BOOKING" for item in violations)


def test_capacity_mismatch_detected(db_session):
    session = db_session.query(Session).filter_by(requirement_id="REQ-DEMO-001").one()
    slot = _slot(db_session)
    run = _create_run(db_session, [(session, _room(db_session, "LAB-01"), slot)])

    violations = ConstraintService().check_schedule(db_session, run.id)

    assert any(item["constraint_code"] == "ROOM_CAPACITY_MISMATCH" for item in violations)


def test_online_session_in_physical_room_detected(db_session):
    session = db_session.query(Session).filter_by(requirement_id="REQ-DEMO-004").one()
    slot = _slot(db_session)
    run = _create_run(db_session, [(session, _room(db_session, "SR-01"), slot)])

    violations = ConstraintService().check_schedule(db_session, run.id)

    assert any(item["constraint_code"] == "DELIVERY_ROOM_MISMATCH" for item in violations)


def test_12_to_14_session_satisfies_lunch_break_when_11_to_12_is_free(db_session):
    session = db_session.query(Session).filter_by(requirement_id="REQ-DEMO-001").one()
    run = _create_run(db_session, [(session, _room(db_session, "LECT-01"), _slot_at(db_session, "12:00", "14:00"))])

    violations = ConstraintService().check_schedule(db_session, run.id)

    assert not any(item["constraint_code"] in {"STAFF_LUNCH_BREAK", "STUDENT_GROUP_LUNCH_BREAK"} for item in violations)


def test_missing_flexible_lunch_break_is_detected_for_staff_and_group(db_session):
    sessions = db_session.query(Session).order_by(Session.id).limit(3).all()
    sessions[1].student_group_id = sessions[0].student_group_id
    sessions[2].student_group_id = sessions[0].student_group_id
    sessions[1].staff_id = sessions[0].staff_id
    sessions[2].staff_id = sessions[0].staff_id
    room = _room(db_session, "SR-02")
    run = _create_run(
        db_session,
        [
            (sessions[0], room, _slot_at(db_session, "10:00", "12:00")),
            (sessions[1], room, _slot_at(db_session, "12:00", "13:00")),
            (sessions[2], room, _slot_at(db_session, "13:00", "15:00")),
        ],
    )

    violations = ConstraintService().check_schedule(db_session, run.id)

    assert any(item["constraint_code"] == "STAFF_LUNCH_BREAK" for item in violations)
    assert any(item["constraint_code"] == "STUDENT_GROUP_LUNCH_BREAK" for item in violations)


def test_class_after_1700_rule_is_seeded(db_session):
    rule = db_session.query(Rule).filter_by(rule_id="CLASS_AFTER_1700").one()

    assert rule.is_enabled is True
    assert rule.severity == "SOFT"
    assert json.loads(rule.params_json)["limit"] == 1700


def test_class_after_1700_rule_can_be_disabled(db_session):
    rule = db_session.query(Rule).filter_by(rule_id="CLASS_AFTER_1700").one()
    rule.is_enabled = False
    session = db_session.query(Session).filter_by(requirement_id="REQ-DEMO-001").one()
    run = _create_run(db_session, [(session, _room(db_session, "LECT-01"), _slot_at(db_session, "17:00", "18:00"))])

    violations = ConstraintService().check_schedule(db_session, run.id)

    assert not any(item["constraint_code"] == "CLASS_AFTER_1700" for item in violations)


def test_class_after_1700_rule_limit_is_configurable(db_session):
    rule = db_session.query(Rule).filter_by(rule_id="CLASS_AFTER_1700").one()
    rule.params_json = json.dumps({"limit": 1800})
    session = db_session.query(Session).filter_by(requirement_id="REQ-DEMO-001").one()
    run = _create_run(db_session, [(session, _room(db_session, "LECT-01"), _slot_at(db_session, "17:00", "18:00"))])

    violations = ConstraintService().check_schedule(db_session, run.id)

    assert not any(item["constraint_code"] == "CLASS_AFTER_1700" for item in violations)


def test_resolution_service_suggests_fixed_late_class_moves(db_session):
    session = db_session.query(Session).filter_by(requirement_id="REQ-DEMO-001").one()
    session.scheduling_type = "Fixed"
    session.fixed_day = "Monday"
    session.fixed_start_time = "17:00"
    session.fixed_end_time = "18:00"
    session.duration_minutes = 60
    session.week_pattern = "Weekly"
    run = _create_run(db_session, [(session, _room(db_session, "LECT-01"), _slot_at(db_session, "17:00", "18:00"))])
    check = ConstraintService().check_and_store(db_session, run.id, {"CLASS_AFTER_1700": 10})
    assert any(item["constraint_code"] == "CLASS_AFTER_1700" for item in check["violations"])
    violation_row = db_session.query(ConstraintViolation).filter_by(
        schedule_run_id=run.id,
        constraint_code="CLASS_AFTER_1700",
    ).one()

    suggestions = ResolutionService().suggestions_for_violation(db_session, run.id, violation_row.id, 3)
    assert suggestions
    assert suggestions[0]["end_time"] <= "17:00"
    assert suggestions[0]["requires_fixed_update"] is True
