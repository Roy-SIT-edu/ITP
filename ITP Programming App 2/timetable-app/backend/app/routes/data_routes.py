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

