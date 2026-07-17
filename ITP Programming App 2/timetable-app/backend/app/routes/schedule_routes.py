"""API routes for generating and reading timetable schedules."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app.models.constraint_violation import ConstraintViolation
from app.models.room import Room
from app.models.schedule_run import ScheduleRun
from app.models.scheduled_session import ScheduledSession
from app.models.time_slot import TimeSlot
from app.services.academic_calendar_service import AcademicCalendarService
from app.services.auto_deconflict_service import AutoDeconflictConflictError, ScheduleRunNotFoundError
from app.services.compatibility import is_online_mode, parse_day_list
from app.services.constraint_service import ConstraintService
from app.services.export_service import ExportService
from app.services.lab_overlap_service import LabOverlapService
from app.services.quick_fix_service import QuickFixService
from app.services.schedule_quality_service import schedule_quality_from_violations
from app.services.schedule_report_service import ScheduleReportService
from app.services.schedule_service import ScheduleService
from app.services.scheduling_constants import SCHEDULING_DAY_END_TIME
from app.services.scheduling_rules import candidate_room_allowed, candidate_slot_allowed, session_is_initially_fixed
from app.services.serializers import schedule_run_to_dict, violation_to_dict
from app.services.soft_constraint_priority_service import SoftConstraintPriorityService

router = APIRouter(prefix="/api/schedules", tags=["schedules"])


class ManualMoveInput(BaseModel):
    day: str
    start_time: str
    end_time: str
    room_code: str


class QuickFixInput(BaseModel):
    conflict_id: int | None = None
    session_id: int | None = None


class ScheduleGenerationInput(BaseModel):
    academic_year: str
    trimester: int


@router.post("/generate")
def generate_schedule(
    data: ScheduleGenerationInput,
    mode: Literal["standard", "reproducible"] = Query(default="standard"),
    db: DbSession = Depends(get_db),
):
    if data.trimester not in {1, 2, 3}:
        raise HTTPException(status_code=400, detail="Trimester must be 1, 2, or 3.")
    try:
        return ScheduleService().generate(
            db,
            academic_year=data.academic_year,
            trimester=data.trimester,
            reproducible=mode == "reproducible",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{schedule_run_id}/auto-deconflict")
def auto_deconflict_schedule(
    schedule_run_id: int,
    timeout_seconds: float | None = Query(default=None, ge=1.0, le=120.0),
    db: DbSession = Depends(get_db),
):
    try:
        return ScheduleService().auto_deconflict(db, schedule_run_id, timeout=timeout_seconds)
    except ScheduleRunNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AutoDeconflictConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("")
def schedule_runs(db: DbSession = Depends(get_db)):
    runs = db.query(ScheduleRun).order_by(ScheduleRun.id.desc()).limit(20).all()
    return [schedule_run_to_dict(item) for item in runs]


@router.get("/compare")
def compare_schedules(ids: list[int] | None = Query(default=None), db: DbSession = Depends(get_db)):
    query = db.query(ScheduleRun).order_by(ScheduleRun.id.desc())
    runs = query.filter(ScheduleRun.id.in_(ids)).all() if ids else query.limit(5).all()
    rows = []
    for run in runs:
        scheduled_count = (
            db.query(ScheduledSession)
            .filter(
                ScheduledSession.schedule_run_id == run.id,
                ScheduledSession.included_in_final.is_(True),
            )
            .count()
        )
        violations = db.query(ConstraintViolation).filter_by(schedule_run_id=run.id).all()
        hard = sum(1 for item in violations if (item.severity or "").upper() == "HARD")
        soft = sum(1 for item in violations if (item.severity or "").upper() == "SOFT")
        quality = schedule_quality_from_violations(
            scheduled_count=scheduled_count,
            raw_soft_score=run.soft_score or 0,
            violations=violations,
        )
        rows.append(
            {
                **schedule_run_to_dict(run),
                "scheduled_count": scheduled_count,
                "stored_hard_issues": hard,
                "stored_soft_issues": soft,
                "quality_score": quality["score"],
                "quality": quality,
            }
        )
    return rows


@router.get("/latest")
def latest_schedule(db: DbSession = Depends(get_db)):
    run = db.query(ScheduleRun).order_by(ScheduleRun.id.desc()).first()
    if not run:
        raise HTTPException(status_code=404, detail={"message": "No schedule runs found"})
    return {
        "schedule_run": _schedule_run_with_quality(db, run),
        "scheduled_sessions": ExportService().schedule_rows(db, run.id),
    }


@router.get("/{schedule_run_id}")
def schedule(schedule_run_id: int, db: DbSession = Depends(get_db)):
    run = db.query(ScheduleRun).filter_by(id=schedule_run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail={"message": "Schedule run not found"})
    return {
        "schedule_run": _schedule_run_with_quality(db, run),
        "scheduled_sessions": ExportService().schedule_rows(db, run.id),
    }


@router.get("/{schedule_run_id}/sessions/{session_id}/move-options")
def scheduled_session_move_options(
    schedule_run_id: int,
    session_id: int,
    room_code: str = Query(..., min_length=1),
    db: DbSession = Depends(get_db),
):
    try:
        return QuickFixService().move_options(db, schedule_run_id, session_id, room_code)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/{schedule_run_id}/sessions/{session_id}")
def move_scheduled_session(schedule_run_id: int, session_id: int, data: ManualMoveInput, db: DbSession = Depends(get_db)):
    item = (
        db.query(ScheduledSession)
        .filter(
            ScheduledSession.schedule_run_id == schedule_run_id,
            ScheduledSession.session_id == session_id,
            ScheduledSession.included_in_final.is_(True),
        )
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Scheduled session not found.")
    if item.session and item.session.is_lab_requirement:
        raise HTTPException(
            status_code=409,
            detail="Built-in lab bookings are hard constraints. Edit the Lab Requirements database row instead.",
        )
    room = db.query(Room).filter_by(room_code=data.room_code).first()
    if not room:
        raise HTTPException(status_code=400, detail="Room not found.")
    if data.end_time > SCHEDULING_DAY_END_TIME:
        raise HTTPException(
            status_code=400,
            detail=f"Classes must end by {SCHEDULING_DAY_END_TIME}.",
        )
    slot = (
        db.query(TimeSlot)
        .filter_by(day=data.day, start_time=data.start_time, end_time=data.end_time, week_pattern=item.week_pattern)
        .filter(TimeSlot.end_time <= SCHEDULING_DAY_END_TIME)
        .first()
    )
    if not slot:
        raise HTTPException(status_code=400, detail="No matching time slot exists for that day, time, and week pattern.")
    if not candidate_slot_allowed(item.session, slot, relax_fixed=True):
        raise HTTPException(status_code=409, detail="Cannot move here: the time slot violates a hard requirement.")
    if not candidate_room_allowed(item.session, room, relax_fixed=True):
        raise HTTPException(status_code=409, detail="Cannot move here: the room does not meet this session's requirements.")

    item.room_id = room.id
    item.room = room
    item.time_slot_id = slot.id
    item.time_slot = slot
    item.day = slot.day
    item.start_time = slot.start_time
    item.end_time = slot.end_time
    item.week_pattern = slot.week_pattern

    preview_violations = ConstraintService().check_schedule(db, schedule_run_id)
    blocking_violations = _hard_violations_for_session(preview_violations, session_id)
    if blocking_violations:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail={
                "message": _manual_move_blocked_message(blocking_violations),
                "violations": blocking_violations,
            },
        )

    soft_weights = SoftConstraintPriorityService().weights(db)
    check = ConstraintService().check_and_store(db, schedule_run_id, soft_weights)
    run = db.query(ScheduleRun).filter_by(id=schedule_run_id).first()
    if run:
        run.hard_violation_count = check["hard_violation_count"]
        run.soft_score = check["weighted_soft_score"]
        run.status = "COMPLETED" if run.hard_violation_count == 0 else "COMPLETED_WITH_CONFLICTS"
        AcademicCalendarService().sync_run_occurrences(db, run)
    db.commit()
    return {
        "message": "Scheduled session moved.",
        "schedule_run": _schedule_run_with_quality(db, run) if run else None,
        "violations": check["violations"],
    }


@router.post("/{schedule_run_id}/suggest-fixes")
def suggest_schedule_fixes(schedule_run_id: int, data: QuickFixInput, db: DbSession = Depends(get_db)):
    try:
        return QuickFixService().suggest_fixes(db, schedule_run_id, data.conflict_id, data.session_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{schedule_run_id}/quick-fix-availability")
def quick_fix_availability(schedule_run_id: int, db: DbSession = Depends(get_db)):
    try:
        return QuickFixService().availability(db, schedule_run_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{schedule_run_id}/recheck")
def recheck_schedule(schedule_run_id: int, db: DbSession = Depends(get_db)):
    run = db.query(ScheduleRun).filter_by(id=schedule_run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Schedule run not found.")
    soft_weights = SoftConstraintPriorityService().weights(db)
    lab_overlap_resolution = LabOverlapService().resolve_run(db, schedule_run_id)
    check = ConstraintService().check_and_store(db, schedule_run_id, soft_weights)
    run.hard_violation_count = check["hard_violation_count"]
    run.soft_score = check["weighted_soft_score"]
    run.status = "COMPLETED" if run.hard_violation_count == 0 else "COMPLETED_WITH_CONFLICTS"
    AcademicCalendarService().sync_run_occurrences(db, run)
    db.commit()
    return {
        "message": "Schedule rechecked.",
        "schedule_run": _schedule_run_with_quality(db, run),
        "violations": check["violations"],
        "lab_overlap_resolution": lab_overlap_resolution,
    }


@router.get("/{schedule_run_id}/report")
def schedule_report(schedule_run_id: int, db: DbSession = Depends(get_db)):
    try:
        return ScheduleReportService().build(db, schedule_run_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail={"message": str(exc)}) from exc


@router.get("/{schedule_run_id}/report.pdf")
def schedule_report_pdf(schedule_run_id: int, db: DbSession = Depends(get_db)):
    service = ScheduleReportService()
    try:
        report = service.build(db, schedule_run_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail={"message": str(exc)}) from exc
    return StreamingResponse(
        service.pdf_buffer(report),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=timetable_run_{schedule_run_id}_admin_report.pdf"},
    )


@router.get("/{schedule_run_id}/explanations")
def schedule_explanations(schedule_run_id: int, db: DbSession = Depends(get_db)):
    scheduled = (
        db.query(ScheduledSession)
        .filter(
            ScheduledSession.schedule_run_id == schedule_run_id,
            ScheduledSession.included_in_final.is_(True),
        )
        .order_by(ScheduledSession.day, ScheduledSession.start_time)
        .all()
    )
    violations = db.query(ConstraintViolation).filter_by(schedule_run_id=schedule_run_id).all()
    by_session: dict[int, list[dict]] = {}
    for violation in violations:
        for session_id in violation_to_dict(violation)["affected_session_ids"]:
            by_session.setdefault(session_id, []).append(violation_to_dict(violation))

    explanations = []
    for item in scheduled:
        session = item.session
        reasons = []
        if session.is_lab_requirement:
            reasons.append(
                f"Built-in lab placed at its database slot: {session.fixed_day} {session.fixed_start_time}-{session.fixed_end_time}."
            )
        elif session_is_initially_fixed(session):
            reasons.append(
                f"Excel fixed timing was honored on initial generation: "
                f"{session.fixed_day} {session.fixed_start_time}-{session.fixed_end_time}. "
                "This run assignment can still be corrected manually or by Auto Deconflict."
            )
        else:
            preferred = parse_day_list(session.preferred_days)
            avoid = parse_day_list(session.avoid_days)
            if preferred:
                reasons.append("Matched a preferred day." if item.day in preferred else "Could not match preferred days.")
            if avoid:
                reasons.append("Avoided blocked days." if item.day not in avoid else "Landed on an avoided day, counted as soft pressure.")
        if is_online_mode(session.delivery_mode):
            reasons.append("Online delivery uses a virtual room.")
        else:
            reasons.append(f"Room {item.room.room_code} fits {session.venue_type_required} delivery and capacity.")
        if by_session.get(session.id):
            reasons.append(f"{len(by_session[session.id])} post-generation issue(s) reference this session.")
        explanations.append(
            {
                "session_id": session.id,
                "requirement_id": session.requirement_id,
                "module_code": session.module.module_code if session.module else None,
                "placement": f"{item.day} {item.start_time}-{item.end_time} in {item.room.room_code}",
                "reasons": reasons,
                "issues": by_session.get(session.id, []),
            }
        )
    return explanations


@router.get("/{schedule_run_id}/violations")
def schedule_violations(schedule_run_id: int, db: DbSession = Depends(get_db)):
    return [
        violation_to_dict(item)
        for item in db.query(ConstraintViolation)
        .filter_by(schedule_run_id=schedule_run_id)
        .order_by(ConstraintViolation.severity, ConstraintViolation.constraint_code)
        .all()
    ]


def _schedule_run_with_quality(db: DbSession, run: ScheduleRun) -> dict:
    scheduled_count = (
        db.query(ScheduledSession)
        .filter(
            ScheduledSession.schedule_run_id == run.id,
            ScheduledSession.included_in_final.is_(True),
        )
        .count()
    )
    violations = db.query(ConstraintViolation).filter_by(schedule_run_id=run.id).all()
    return {
        **schedule_run_to_dict(run),
        "quality": schedule_quality_from_violations(
            scheduled_count=scheduled_count,
            raw_soft_score=run.soft_score or 0,
            violations=violations,
        ),
    }


def _hard_violations_for_session(violations: list[dict], session_id: int) -> list[dict]:
    return [
        violation
        for violation in violations
        if violation.get("severity") == "HARD" and session_id in violation.get("affected_session_ids", [])
    ]


def _manual_move_blocked_message(violations: list[dict]) -> str:
    code = violations[0].get("constraint_code") if violations else ""
    messages = {
        "STAFF_DOUBLE_BOOKING": "Cannot move here: Staff member is double-booked.",
        "ROOM_DOUBLE_BOOKING": "Cannot move here: Room is double-booked.",
        "STUDENT_GROUP_DOUBLE_BOOKING": "Cannot move here: Student group is double-booked.",
        "ROOM_CAPACITY_MISMATCH": "Cannot move here: Room capacity is too low.",
        "DELIVERY_ROOM_MISMATCH": "Cannot move here: Room type does not match the session delivery mode.",
        "INVALID_FIXED_TIME": "Cannot move here: Fixed session would be outside its fixed slot.",
    }
    return messages.get(code, "Cannot move here: this placement creates a hard conflict.")
