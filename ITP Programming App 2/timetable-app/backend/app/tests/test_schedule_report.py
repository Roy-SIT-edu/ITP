"""Tests for per-run administration reports."""

from app.database import get_db
from app.main import app
from app.models.constraint_violation import ConstraintViolation
from app.models.room import Room
from app.models.schedule_change_log import ScheduleChangeLog
from app.models.schedule_run import ScheduleRun
from app.models.scheduled_session import ScheduledSession
from app.models.session import Session
from app.models.time_slot import TimeSlot
from app.services.schedule_report_service import ScheduleReportService
from fastapi.testclient import TestClient


def _add_report_run(db_session) -> ScheduleRun:
    session = db_session.query(Session).filter_by(requirement_id="REQ-DEMO-001").one()
    room = db_session.query(Room).filter_by(room_code="LECT-01").one()
    slot = db_session.query(TimeSlot).filter_by(day="Wednesday", start_time="09:00", end_time="11:00", week_pattern="Weekly").one()
    run = ScheduleRun(status="COMPLETED", solver_status="OPTIMAL", soft_score=25)
    db_session.add(run)
    db_session.flush()
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
    db_session.add(
        ConstraintViolation(
            schedule_run_id=run.id,
            constraint_code="PREFERRED_DAY_MISMATCH",
            severity="SOFT",
            message="Session did not use a preferred day.",
            affected_session_ids=str(session.id),
        )
    )
    db_session.commit()
    return run


def test_schedule_report_contains_breakdowns_conflicts_and_pdf(db_session):
    run = _add_report_run(db_session)
    service = ScheduleReportService()

    report = service.build(db_session, run.id)

    assert report["summary"]["scheduled_count"] == 1
    assert report["summary"]["uploaded_session_count"] == 1
    assert report["summary"]["lab_session_count"] == 0
    assert report["conflicts"]["soft_count"] == 1
    assert report["conflicts"]["items"][0]["affected_sessions"][0]["module_code"] == "DSC2204"
    assert report["sessions"][0]["issue_codes"] == ["PREFERRED_DAY_MISMATCH"]
    assert report["quality_breakdown"]["factor_deduction_total"] == 56
    assert report["quality_breakdown"]["score_before_cap"] == 44
    assert report["quality_breakdown"]["hard_conflict_cap_deduction"] == 0
    assert [factor["deduction"] for factor in report["quality_breakdown"]["factors"]] == [0, 35, 20, 1]
    assert report["quality_breakdown"]["factors"][1]["observed"].startswith("1 soft warning across 1")
    assert report["changes"] == {
        "count": 0,
        "auto_deconflict_count": 0,
        "quick_fix_count": 0,
        "manual_change_count": 0,
        "items": [],
    }

    pdf = service.pdf_buffer(report).getvalue()
    assert pdf.startswith(b"%PDF-")
    assert len(pdf) > 5_000


def test_schedule_report_routes_return_json_and_pdf(db_session):
    run = _add_report_run(db_session)

    def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    try:
        client = TestClient(app)
        report_response = client.get(f"/api/schedules/{run.id}/report")
        pdf_response = client.get(f"/api/schedules/{run.id}/report.pdf")
    finally:
        app.dependency_overrides.clear()

    assert report_response.status_code == 200
    assert report_response.json()["run"]["id"] == run.id
    assert pdf_response.status_code == 200
    assert pdf_response.headers["content-type"] == "application/pdf"
    assert f"timetable_run_{run.id}_admin_report.pdf" in pdf_response.headers["content-disposition"]
    assert pdf_response.content.startswith(b"%PDF-")


def test_schedule_report_lists_each_recorded_placement_change(db_session):
    run = _add_report_run(db_session)
    scheduled = db_session.query(ScheduledSession).filter_by(schedule_run_id=run.id).one()
    db_session.add(
        ScheduleChangeLog(
            schedule_run_id=run.id,
            session_id=scheduled.session_id,
            change_source="QUICK_FIX",
            before_day="Monday",
            before_start_time="13:00",
            before_end_time="15:00",
            before_room_code="SR-01",
            before_week_pattern="Weekly",
            after_day=scheduled.day,
            after_start_time=scheduled.start_time,
            after_end_time=scheduled.end_time,
            after_room_code=scheduled.room.room_code,
            after_week_pattern=scheduled.week_pattern,
        )
    )
    db_session.commit()

    report = ScheduleReportService().build(db_session, run.id)

    assert report["changes"]["count"] == 1
    assert report["changes"]["quick_fix_count"] == 1
    assert report["changes"]["auto_deconflict_count"] == 0
    assert report["changes"]["items"][0]["source_label"] == "Quick Fix"
    assert report["changes"]["items"][0]["module_code"] == "DSC2204"
    assert report["changes"]["items"][0]["before"]["room_code"] == "SR-01"
    assert report["changes"]["items"][0]["after"]["room_code"] == "LECT-01"
    assert report["changes"]["items"][0]["changed_fields"] == ["Day", "Time", "Room"]
    assert report["changes"]["items"][0]["is_inferred"] is False


def test_quick_fix_move_records_report_audit_row(db_session):
    run = _add_report_run(db_session)
    scheduled = db_session.query(ScheduledSession).filter_by(schedule_run_id=run.id).one()

    def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    try:
        response = TestClient(app).put(
            f"/api/schedules/{run.id}/sessions/{scheduled.session_id}",
            json={
                "day": "Thursday",
                "start_time": "09:00",
                "end_time": "11:00",
                "room_code": "LECT-01",
                "change_source": "QUICK_FIX",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    change = db_session.query(ScheduleChangeLog).filter_by(schedule_run_id=run.id).one()
    assert change.change_source == "QUICK_FIX"
    assert change.before_day == "Wednesday"
    assert change.after_day == "Thursday"
