"""Tests for one-click timetable quick-fix suggestions."""

from app.models.constraint_violation import ConstraintViolation
from app.models.room import Room
from app.models.schedule_run import ScheduleRun
from app.models.scheduled_session import ScheduledSession
from app.models.session import Session
from app.models.time_slot import TimeSlot
from app.services.constraint_service import ConstraintService
from app.services.quick_fix_service import QuickFixService


def test_quick_fix_suggests_clean_room_change_for_room_conflict(db_session):
    sessions = db_session.query(Session).order_by(Session.id).limit(2).all()
    groups = [session.student_group_id for session in db_session.query(Session).order_by(Session.id).all()]
    sessions[0].delivery_mode = "Face-to-face"
    sessions[0].venue_type_required = "classroom"
    sessions[0].exact_class_size = 20
    sessions[0].duration_minutes = 120
    sessions[0].week_pattern = "Weekly"
    sessions[1].delivery_mode = "Face-to-face"
    sessions[1].venue_type_required = "classroom"
    sessions[1].exact_class_size = 20
    sessions[1].duration_minutes = 120
    sessions[1].week_pattern = "Weekly"
    sessions[1].student_group_id = next(group_id for group_id in groups if group_id != sessions[0].student_group_id)
    sessions[1].staff_id = next(
        staff_id
        for staff_id in {session.staff_id for session in db_session.query(Session).all() if session.staff_id}
        if staff_id != sessions[0].staff_id
    )

    slot = db_session.query(TimeSlot).filter_by(day="Monday", start_time="09:00", end_time="11:00", week_pattern="Weekly").one()
    room = db_session.query(Room).filter_by(room_code="SR-02").one()
    run = ScheduleRun(status="COMPLETED", solver_status="TEST")
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
    db_session.flush()
    ConstraintService().check_and_store(db_session, run.id)
    violation = db_session.query(ConstraintViolation).filter_by(constraint_code="ROOM_DOUBLE_BOOKING").one()

    result = QuickFixService().suggest_fixes(db_session, run.id, conflict_id=violation.id)

    assert result["conflict_id"] == violation.id
    assert result["severity"] == "HARD"
    assert result["session_id"] == sessions[0].id
    assert result["suggestions"][0]["type"] == "VENUE_CHANGE"
    assert result["suggestions"][0]["day"] == "Monday"
    assert result["suggestions"][0]["start_time"] == "09:00"
    assert result["suggestions"][0]["end_time"] == "11:00"
    assert result["suggestions"][0]["room_code"] != "SR-02"
