"""API routes for generating and reading timetable schedules."""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app.models.constraint_violation import ConstraintViolation
from app.models.room import Room
from app.models.schedule_run import ScheduleRun
from app.models.scheduled_session import ScheduledSession
from app.models.time_slot import TimeSlot
from app.services.compatibility import is_online_mode, normalize_token, parse_day_list
from app.services.constraint_service import ConstraintService
from app.services.export_service import ExportService
from app.services.resolution_service import ResolutionService
from app.services.schedule_service import ScheduleService
from app.services.soft_constraint_priority_service import SoftConstraintPriorityService
from app.services.serializers import schedule_run_to_dict, violation_to_dict

router = APIRouter(prefix="/api/schedules", tags=["schedules"])


class ManualMoveInput(BaseModel):
    day: str
    start_time: str
    end_time: str
    room_code: str
    update_fixed_requirement: bool = False


@router.post("/generate")
def generate_schedule(db: DbSession = Depends(get_db)):
    result = ScheduleService().generate(db)
    if result.get("error") == "VALIDATION_FAILED":
        raise HTTPException(status_code=400, detail=result)
    return result


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
        scheduled_count = db.query(ScheduledSession).filter_by(schedule_run_id=run.id).count()
        violations = db.query(ConstraintViolation).filter_by(schedule_run_id=run.id).all()
        hard = sum(1 for item in violations if (item.severity or "").upper() == "HARD")
        soft = sum(1 for item in violations if (item.severity or "").upper() == "SOFT")
        rows.append(
            {
                **schedule_run_to_dict(run),
                "scheduled_count": scheduled_count,
                "stored_hard_issues": hard,
                "stored_soft_issues": soft,
                "quality_score": max(0, 100 - (hard * 20) - int(run.soft_score or 0)),
            }
        )
    return rows


@router.get("/latest")
def latest_schedule(db: DbSession = Depends(get_db)):
    run = db.query(ScheduleRun).order_by(ScheduleRun.id.desc()).first()
    if not run:
        raise HTTPException(status_code=404, detail={"message": "No schedule runs found"})
    return {
        "schedule_run": schedule_run_to_dict(run),
        "scheduled_sessions": ExportService().schedule_rows(db, run.id),
    }


@router.get("/{schedule_run_id}")
def schedule(schedule_run_id: int, db: DbSession = Depends(get_db)):
    run = db.query(ScheduleRun).filter_by(id=schedule_run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail={"message": "Schedule run not found"})
    return {
        "schedule_run": schedule_run_to_dict(run),
        "scheduled_sessions": ExportService().schedule_rows(db, run.id),
    }


@router.put("/{schedule_run_id}/sessions/{session_id}")
def move_scheduled_session(schedule_run_id: int, session_id: int, data: ManualMoveInput, db: DbSession = Depends(get_db)):
    item = db.query(ScheduledSession).filter_by(schedule_run_id=schedule_run_id, session_id=session_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Scheduled session not found.")
    room = db.query(Room).filter_by(room_code=data.room_code).first()
    if not room:
        raise HTTPException(status_code=400, detail="Room not found.")
    slot = (
        db.query(TimeSlot)
        .filter_by(day=data.day, start_time=data.start_time, end_time=data.end_time, week_pattern=item.week_pattern)
        .first()
    )
    if not slot:
        raise HTTPException(status_code=400, detail="No matching time slot exists for that day, time, and week pattern.")

    item.room_id = room.id
    item.time_slot_id = slot.id
    item.day = slot.day
    item.start_time = slot.start_time
    item.end_time = slot.end_time
    item.week_pattern = slot.week_pattern
    if data.update_fixed_requirement and normalize_token(item.session.scheduling_type) == "fixed":
        item.session.fixed_day = slot.day
        item.session.fixed_start_time = slot.start_time
        item.session.fixed_end_time = slot.end_time

    soft_weights = SoftConstraintPriorityService().weights(db)
    check = ConstraintService().check_and_store(db, schedule_run_id, soft_weights)
    run = db.query(ScheduleRun).filter_by(id=schedule_run_id).first()
    if run:
        run.hard_violation_count = check["hard_violation_count"]
        run.soft_score = check["weighted_soft_score"]
        run.status = "COMPLETED" if run.hard_violation_count == 0 else "COMPLETED_WITH_CONFLICTS"
    db.commit()
    return {
        "message": "Scheduled session moved.",
        "schedule_run": schedule_run_to_dict(run) if run else None,
        "violations": check["violations"],
    }


@router.get("/{schedule_run_id}/violations/{violation_id}/suggestions")
def resolution_suggestions(
    schedule_run_id: int,
    violation_id: int,
    limit: int = Query(default=3, ge=1, le=5),
    db: DbSession = Depends(get_db),
):
    if not db.query(ScheduleRun).filter_by(id=schedule_run_id).first():
        raise HTTPException(status_code=404, detail={"message": "Schedule run not found"})
    return ResolutionService().suggestions_for_violation(db, schedule_run_id, violation_id, limit)


@router.get("/{schedule_run_id}/explanations")
def schedule_explanations(schedule_run_id: int, db: DbSession = Depends(get_db)):
    scheduled = (
        db.query(ScheduledSession)
        .filter_by(schedule_run_id=schedule_run_id)
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
        if session.scheduling_type == "Fixed":
            reasons.append(f"Placed at its fixed slot: {session.fixed_day} {session.fixed_start_time}-{session.fixed_end_time}.")
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
