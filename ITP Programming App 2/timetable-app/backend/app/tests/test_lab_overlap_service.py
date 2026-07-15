"""Regression tests for minimum fixed-lab exclusion plans."""

from app.models.room import Room
from app.models.schedule_run import ScheduleRun
from app.models.scheduled_session import ScheduledSession
from app.models.session import Session
from app.models.staff import Staff
from app.models.student_group import StudentGroup
from app.models.time_slot import TimeSlot
from app.services.constraint_service import ConstraintService
from app.services.export_service import ExportService
from app.services.lab_overlap_service import LabOverlapService
from app.services.schedule_report_service import ScheduleReportService


def _add_star_overlap_run(db_session) -> tuple[ScheduleRun, list[Session]]:
    sessions = db_session.query(Session).order_by(Session.id).limit(4).all()
    rooms = db_session.query(Room).filter(Room.is_virtual.is_(False)).order_by(Room.id).limit(3).all()
    staff = db_session.query(Staff).order_by(Staff.id).limit(3).all()
    groups = db_session.query(StudentGroup).order_by(StudentGroup.id).limit(3).all()
    slot = db_session.query(TimeSlot).filter_by(day="Monday", start_time="09:00", end_time="11:00", week_pattern="Weekly").one()
    assert len(sessions) == 4
    assert len(rooms) == 3
    assert len(staff) == 3
    assert len(groups) == 3

    # The first lab is the centre of a three-edge overlap graph. It shares a
    # room with lab 2, a staff member with lab 3, and a student group with lab 4.
    placements = [
        (rooms[0], staff[0], groups[0]),
        (rooms[0], staff[1], groups[1]),
        (rooms[1], staff[0], groups[2]),
        (rooms[2], staff[2], groups[0]),
    ]
    for index, (session, (_, assigned_staff, group)) in enumerate(zip(sessions, placements, strict=True), start=1):
        session.requirement_id = f"LAB-OVERLAP-{index}"
        session.is_lab_requirement = True
        session.lab_requirement_id = 10_000 + index
        session.staff_id = assigned_staff.id
        session.student_group_id = group.id
        session.fixed_day = slot.day
        session.fixed_start_time = slot.start_time
        session.fixed_end_time = slot.end_time
        session.week_pattern = "Weekly"
        session.start_week = 1
        session.end_week = 13

    run = ScheduleRun(status="COMPLETED", solver_status="FEASIBLE")
    db_session.add(run)
    db_session.flush()
    for session, (room, assigned_staff, _) in zip(sessions, placements, strict=True):
        db_session.add(
            ScheduledSession(
                schedule_run_id=run.id,
                session_id=session.id,
                room_id=room.id,
                time_slot_id=slot.id,
                staff_id=assigned_staff.id,
                day=slot.day,
                start_time=slot.start_time,
                end_time=slot.end_time,
                week_pattern=slot.week_pattern,
            )
        )
    db_session.commit()
    return run, sessions


def test_minimum_exclusion_removes_one_central_lab_without_deleting_requirements(db_session):
    run, sessions = _add_star_overlap_run(db_session)
    source_snapshot = {item.id: (item.requirement_id, item.fixed_day, item.fixed_start_time, item.fixed_end_time) for item in sessions}

    resolution = LabOverlapService().resolve_run(db_session, run.id)
    db_session.commit()

    assert resolution["detected_pair_count"] == 3
    assert resolution["excluded_session_count"] == 1
    assert resolution["excluded_session_ids"] == [sessions[0].id]
    assert db_session.query(Session).filter(Session.id.in_([item.id for item in sessions])).count() == 4
    assert {
        item.id: (item.requirement_id, item.fixed_day, item.fixed_start_time, item.fixed_end_time)
        for item in db_session.query(Session).filter(Session.id.in_([item.id for item in sessions])).all()
    } == source_snapshot

    assignments = db_session.query(ScheduledSession).filter_by(schedule_run_id=run.id).order_by(ScheduledSession.session_id).all()
    assert len(assignments) == 4
    assert [item.session_id for item in assignments if not item.included_in_final] == [sessions[0].id]
    assert (
        LabOverlapService().detect(
            db_session,
            [item for item in assignments if item.included_in_final],
        )
        == []
    )


def test_excluded_labs_are_omitted_from_final_export_and_explained_in_report(db_session):
    run, sessions = _add_star_overlap_run(db_session)
    first = LabOverlapService().resolve_run(db_session, run.id)
    second = LabOverlapService().resolve_run(db_session, run.id)
    check = ConstraintService().check_and_store(db_session, run.id)
    db_session.commit()

    assert first["excluded_session_ids"] == second["excluded_session_ids"] == [sessions[0].id]
    assert check["hard_violation_count"] == 0

    exported_rows = ExportService().system_template_rows(db_session, run.id)
    assert len(exported_rows) == 3
    assert {row["Module"] for row in exported_rows} == {session.module.module_code for session in sessions[1:]}

    report = ScheduleReportService().build(db_session, run.id)
    assert report["summary"]["scheduled_count"] == 3
    assert report["summary"]["original_lab_session_count"] == 4
    assert report["summary"]["excluded_lab_session_count"] == 1
    assert report["lab_overlap_resolution"]["detected_pair_count"] == 3
    assert report["lab_overlap_resolution"]["excluded_session_ids"] == [sessions[0].id]
    assert all(item["resolved_in_final"] for item in report["lab_overlap_resolution"]["overlaps"])
    assert all(item["session_id"] != sessions[0].id for item in report["sessions"])
