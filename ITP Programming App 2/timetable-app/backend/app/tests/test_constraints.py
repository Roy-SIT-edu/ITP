from app.models.room import Room
from app.models.schedule_run import ScheduleRun
"""Tests for post-generation constraint detection."""

from app.models.scheduled_session import ScheduledSession
from app.models.session import Session
from app.models.time_slot import TimeSlot
from app.services.constraint_service import ConstraintService


def _slot(db_session):
    return (
        db_session.query(TimeSlot)
        .filter_by(day="Monday", start_time="09:00", end_time="11:00", week_pattern="Weekly")
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
