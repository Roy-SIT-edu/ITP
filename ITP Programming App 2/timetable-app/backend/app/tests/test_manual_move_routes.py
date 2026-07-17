"""Tests for guarded manual timetable moves."""

from app.database import get_db
from app.main import app
from app.models.room import Room
from app.models.schedule_run import ScheduleRun
from app.models.scheduled_session import ScheduledSession
from app.models.session import Session
from app.models.time_slot import TimeSlot
from fastapi.testclient import TestClient


def test_manual_move_blocks_hard_conflict_and_keeps_original_slot(db_session):
    sessions = db_session.query(Session).filter(Session.staff_id.isnot(None)).order_by(Session.id).limit(2).all()
    all_group_ids = [session.student_group_id for session in db_session.query(Session).order_by(Session.id).all()]
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
    sessions[1].staff_id = sessions[0].staff_id
    sessions[1].student_group_id = next(group_id for group_id in all_group_ids if group_id != sessions[0].student_group_id)

    original_slot = (
        db_session.query(TimeSlot)
        .filter_by(
            day="Tuesday",
            start_time="09:00",
            end_time="11:00",
            week_pattern="Weekly",
        )
        .one()
    )
    blocked_slot = (
        db_session.query(TimeSlot)
        .filter_by(
            day="Monday",
            start_time="09:00",
            end_time="11:00",
            week_pattern="Weekly",
        )
        .one()
    )
    room_a = db_session.query(Room).filter_by(room_code="SR-01").one()
    room_b = db_session.query(Room).filter_by(room_code="SR-02").one()

    run = ScheduleRun(status="COMPLETED", solver_status="TEST")
    db_session.add(run)
    db_session.flush()
    db_session.add(
        ScheduledSession(
            schedule_run_id=run.id,
            session_id=sessions[0].id,
            room_id=room_a.id,
            time_slot_id=blocked_slot.id,
            staff_id=sessions[0].staff_id,
            day=blocked_slot.day,
            start_time=blocked_slot.start_time,
            end_time=blocked_slot.end_time,
            week_pattern=blocked_slot.week_pattern,
        )
    )
    db_session.add(
        ScheduledSession(
            schedule_run_id=run.id,
            session_id=sessions[1].id,
            room_id=room_b.id,
            time_slot_id=original_slot.id,
            staff_id=sessions[1].staff_id,
            day=original_slot.day,
            start_time=original_slot.start_time,
            end_time=original_slot.end_time,
            week_pattern=original_slot.week_pattern,
        )
    )
    db_session.commit()

    def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    client = TestClient(app)
    try:
        options_response = client.get(
            f"/api/schedules/{run.id}/sessions/{sessions[1].id}/move-options",
            params={"room_code": room_b.room_code},
        )
        response = client.put(
            f"/api/schedules/{run.id}/sessions/{sessions[1].id}",
            json={
                "day": blocked_slot.day,
                "start_time": blocked_slot.start_time,
                "end_time": blocked_slot.end_time,
                "room_code": room_b.room_code,
            },
        )

        sessions[1].is_lab_requirement = True
        db_session.commit()
        lab_options_response = client.get(
            f"/api/schedules/{run.id}/sessions/{sessions[1].id}/move-options",
            params={"room_code": room_b.room_code},
        )
    finally:
        app.dependency_overrides.clear()

    assert options_response.status_code == 200
    options = options_response.json()["options"]
    blocked_option = next(
        option for option in options if option["day"] == blocked_slot.day and option["start_time"] == blocked_slot.start_time
    )
    assert blocked_option["status"] == "BLOCKED"
    assert any("Staff" in reason and "assigned to" in reason for reason in blocked_option["reasons"])
    assert any(option["status"] in {"AVAILABLE", "SOFT"} for option in options)

    assert response.status_code == 409
    assert response.json()["detail"]["message"] == "Cannot move here: Staff member is double-booked."

    assert lab_options_response.status_code == 200
    lab_options = [option for option in lab_options_response.json()["options"] if option["status"] != "CURRENT"]
    assert lab_options
    assert all(option["status"] == "BLOCKED" for option in lab_options)

    db_session.expire_all()
    stored = db_session.query(ScheduledSession).filter_by(schedule_run_id=run.id, session_id=sessions[1].id).one()
    assert stored.day == original_slot.day
    assert stored.start_time == original_slot.start_time
    assert stored.end_time == original_slot.end_time
    assert stored.room_id == room_b.id
