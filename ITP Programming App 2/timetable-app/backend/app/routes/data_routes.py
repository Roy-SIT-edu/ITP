"""Core data API routes for dashboard data and requirement CRUD.

Manual requirement saves pass through strict database cross-check validation
before they are written, so the UI cannot create dangling references.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app.models.constraint_violation import ConstraintViolation
from app.models.module import Module
from app.models.programme import Programme
from app.models.room import Room
from app.models.schedule_run import ScheduleRun
from app.models.scheduled_session import ScheduledSession
from app.models.session import Session
from app.models.session_staff import SessionStaff
from app.models.staff import Staff
from app.models.student_group import StudentGroup
from app.models.time_slot import TimeSlot
from app.schemas.session import SessionInput
from app.services.serializers import (
    group_to_dict,
    module_to_dict,
    programme_to_dict,
    room_to_dict,
    schedule_run_to_dict,
    session_to_dict,
    staff_to_dict,
    time_slot_to_dict,
    session_staff_items,
)
from app.services.requirement_input_service import RequirementInputService, RequirementInputValidationError
from app.services.validation_service import ValidationService

router = APIRouter(prefix="/api", tags=["data"])


def clear_schedule_state(db: DbSession) -> None:
    db.query(ConstraintViolation).delete()
    db.query(ScheduledSession).delete()
    db.query(ScheduleRun).delete()


def validation_http_error(exc: RequirementInputValidationError) -> HTTPException:
    return HTTPException(status_code=400, detail=exc.errors)


@router.get("/programmes")
def programmes(db: DbSession = Depends(get_db)):
    return [programme_to_dict(item) for item in db.query(Programme).order_by(Programme.code).all()]


@router.get("/modules")
def modules(db: DbSession = Depends(get_db)):
    return [module_to_dict(item) for item in db.query(Module).order_by(Module.module_code).all()]


@router.get("/student-groups")
def student_groups(db: DbSession = Depends(get_db)):
    return [group_to_dict(item) for item in db.query(StudentGroup).order_by(StudentGroup.group_code).all()]


@router.get("/staff")
def staff(db: DbSession = Depends(get_db)):
    return [staff_to_dict(item) for item in db.query(Staff).order_by(Staff.staff_name).all()]


@router.get("/rooms")
def rooms(db: DbSession = Depends(get_db)):
    return [room_to_dict(item) for item in db.query(Room).order_by(Room.room_code).all()]


@router.get("/timeslots")
def time_slots(db: DbSession = Depends(get_db)):
    return [
        time_slot_to_dict(item)
        for item in db.query(TimeSlot).order_by(TimeSlot.day, TimeSlot.start_time, TimeSlot.week_pattern).all()
    ]


@router.get("/sessions")
def sessions(db: DbSession = Depends(get_db)):
    return [session_to_dict(item) for item in db.query(Session).order_by(Session.id).all()]


@router.get("/sessions/{session_id}")
def get_session(session_id: int, db: DbSession = Depends(get_db)):
    session = db.query(Session).filter_by(id=session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session_to_dict(session)


@router.get("/dashboard")
def dashboard(db: DbSession = Depends(get_db)):
    latest_run = db.query(ScheduleRun).order_by(ScheduleRun.id.desc()).first()
    validation = ValidationService().validate_latest(db)
    return {
        "total_sessions": db.query(Session).count(),
        "imported_rows": db.query(Session).count(),
        "validation": {
            "is_valid": validation["is_valid"],
            "error_count": validation["error_count"],
            "warning_count": validation["warning_count"],
        },
        "latest_schedule": schedule_run_to_dict(latest_run) if latest_run else None,
    }


@router.get("/availability")
def availability(db: DbSession = Depends(get_db)):
    latest_run = db.query(ScheduleRun).order_by(ScheduleRun.id.desc()).first()
    slots = [time_slot_to_dict(item) for item in db.query(TimeSlot).order_by(TimeSlot.day, TimeSlot.start_time).all()]
    if not latest_run:
        return {"schedule_run_id": None, "slots": slots, "staff": [], "rooms": []}

    scheduled = db.query(ScheduledSession).filter_by(schedule_run_id=latest_run.id).all()
    staff_busy: dict[str, dict] = {}
    room_busy: dict[str, dict] = {}
    for item in scheduled:
        room_label = item.room.room_code if item.room else str(item.room_id)
        entry = {
            "session_id": item.session_id,
            "requirement_id": item.session.requirement_id if item.session else None,
            "module_code": item.session.module.module_code if item.session and item.session.module else None,
            "day": item.day,
            "start_time": item.start_time,
            "end_time": item.end_time,
        }
        staff_items = session_staff_items(item.session) if item.session else []
        if not staff_items:
            staff_items = [{"staff_name": str(item.staff_id or "Unassigned"), "staff_id": None}]
        for staff in staff_items:
            staff_label = staff.get("staff_name") or staff.get("staff_id") or "Unassigned"
            staff_busy.setdefault(staff_label, {"name": staff_label, "busy": []})["busy"].append(entry)
        room_busy.setdefault(room_label, {"room_code": room_label, "busy": []})["busy"].append(entry)

    return {
        "schedule_run_id": latest_run.id,
        "slots": slots,
        "staff": sorted(staff_busy.values(), key=lambda item: item["name"]),
        "rooms": sorted(room_busy.values(), key=lambda item: item["room_code"]),
    }


@router.get("/constraint-insights")
def constraint_insights(db: DbSession = Depends(get_db)):
    validation = ValidationService().validate_latest(db)
    latest_run = db.query(ScheduleRun).order_by(ScheduleRun.id.desc()).first()
    schedule_issues = []
    if latest_run:
        schedule_issues = [
            violation_to_summary(item)
            for item in db.query(ConstraintViolation).filter_by(schedule_run_id=latest_run.id).all()
        ]

    counts: dict[str, dict] = {}
    for issue in validation["errors"]:
        key = issue["field"]
        counts.setdefault(key, {"code": key, "severity": "HARD", "count": 0})["count"] += 1
    for violation in schedule_issues:
        counts.setdefault(
            violation["constraint_code"],
            {"code": violation["constraint_code"], "severity": violation["severity"], "count": 0},
        )["count"] += 1

    return {
        "validation_error_count": validation["error_count"],
        "validation_warning_count": validation["warning_count"],
        "latest_schedule_id": latest_run.id if latest_run else None,
        "top_issues": sorted(counts.values(), key=lambda item: item["count"], reverse=True),
    }


def violation_to_summary(item: ConstraintViolation) -> dict:
    return {
        "constraint_code": item.constraint_code,
        "severity": item.severity,
    }


@router.post("/sessions")
def create_session(data: SessionInput, db: DbSession = Depends(get_db)):
    service = RequirementInputService()
    try:
        session_data = service.data_from_input(db, data)
    except RequirementInputValidationError as exc:
        raise validation_http_error(exc) from exc

    session = service.session_from_data(session_data)
    clear_schedule_state(db)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session_to_dict(session)


@router.delete("/sessions")
def reset_sessions(db: DbSession = Depends(get_db)):
    clear_schedule_state(db)
    db.query(SessionStaff).delete()
    rows_deleted = db.query(Session).delete()
    db.commit()
    return {
        "message": "Requirement inputs reset successfully.",
        "rows_deleted": rows_deleted,
    }


@router.put("/sessions/{session_id}")
def update_session(session_id: int, data: SessionInput, db: DbSession = Depends(get_db)):
    session = db.query(Session).filter_by(id=session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    service = RequirementInputService()
    try:
        session_data = service.data_from_input(db, data, existing_session_id=session_id)
    except RequirementInputValidationError as exc:
        raise validation_http_error(exc) from exc

    service.apply_data(session, session_data)
    clear_schedule_state(db)
    db.commit()
    db.refresh(session)
    return session_to_dict(session)


@router.delete("/sessions/{session_id}")
def delete_session(session_id: int, db: DbSession = Depends(get_db)):
    session = db.query(Session).filter_by(id=session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    clear_schedule_state(db)
    db.delete(session)
    db.commit()
    return {"message": "Session deleted successfully"}

