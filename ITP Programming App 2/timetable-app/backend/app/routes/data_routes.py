from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app.models.module import Module
from app.models.programme import Programme
from app.models.room import Room
from app.models.schedule_run import ScheduleRun
from app.models.session import Session
from app.models.staff import Staff
from app.models.student_group import StudentGroup
from app.models.time_slot import TimeSlot
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
from app.services.validation_service import ValidationService

router = APIRouter(prefix="/api", tags=["data"])


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
