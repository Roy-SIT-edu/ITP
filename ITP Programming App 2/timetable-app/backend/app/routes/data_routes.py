from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DbSession
from sqlalchemy import func

from app.database import get_db
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
from app.services.validation_service import ValidationService

router = APIRouter(prefix="/api", tags=["data"])


def upsert_session_dependencies(db: DbSession, data: SessionInput):
    if not (data.staff_name and data.staff_name.strip()) and not (data.staff_id and data.staff_id.strip()):
        raise HTTPException(status_code=400, detail="Either Staff Name or Staff ID must be provided.")

    programme_id = None
    if data.programme:
        prog_code = data.programme.split()[0].strip().upper()
        programme = db.query(Programme).filter(func.lower(Programme.code) == prog_code.lower()).first()
        if not programme:
            programme = Programme(code=prog_code, name=data.programme, cluster=None)
            db.add(programme)
            db.flush()
        programme_id = programme.id

    module_id = None
    if data.module_code:
        mod_code = data.module_code.strip().upper()
        module = db.query(Module).filter(func.lower(Module.module_code) == mod_code.lower()).first()
        if not module:
            module = Module(
                module_code=mod_code,
                module_host_key=data.module_host_key or data.programme or "GEN",
                module_title=data.module_title or mod_code,
                term=None,
            )
            db.add(module)
            db.flush()
        else:
            if data.module_title:
                module.module_title = data.module_title
            if data.module_host_key:
                module.module_host_key = data.module_host_key
        module_id = module.id

    student_group_id = None
    if data.student_group_code:
        grp_code = data.student_group_code.strip().upper()
        group = db.query(StudentGroup).filter(func.lower(StudentGroup.group_code) == grp_code.lower()).first()
        if not group:
            group = StudentGroup(
                group_code=grp_code,
                programme_id=programme_id,
                year=data.year or 1,
                size=data.exact_class_size or 40,
            )
            db.add(group)
            db.flush()
        else:
            if programme_id:
                group.programme_id = programme_id
            if data.year:
                group.year = data.year
            if data.exact_class_size:
                group.size = data.exact_class_size
        student_group_id = group.id

    staff_record_id = None
    if data.staff_id or data.staff_name:
        staff = None
        if data.staff_id:
            staff_id_val = data.staff_id.strip()
            staff = db.query(Staff).filter(func.lower(Staff.staff_id) == staff_id_val.lower()).first()
        if not staff and data.staff_name:
            staff_name_val = data.staff_name.strip()
            staff = db.query(Staff).filter(func.lower(Staff.staff_name) == staff_name_val.lower()).first()
        
        if not staff:
            staff = Staff(
                staff_id=data.staff_id,
                staff_name=data.staff_name or data.staff_id,
                staff_host_key=None,
            )
            db.add(staff)
            db.flush()
        else:
            if data.staff_id:
                staff.staff_id = data.staff_id
            if data.staff_name:
                staff.staff_name = data.staff_name
        staff_record_id = staff.id

    return programme_id, module_id, student_group_id, staff_record_id


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
    prog_id, mod_id, group_id, staff_id = upsert_session_dependencies(db, data)
    session = Session(
        requirement_id=data.requirement_id,
        programme_id=prog_id,
        module_id=mod_id,
        student_group_id=group_id,
        staff_id=staff_id,
        class_type=data.class_type,
        delivery_mode=data.delivery_mode,
        campus_mode=data.campus_mode,
        venue_type_required=data.venue_type_required,
        duration_minutes=data.duration_minutes,
        sessions_per_week=data.sessions_per_week,
        exact_class_size=data.exact_class_size,
        start_week=data.start_week,
        end_week=data.end_week,
        week_pattern=data.week_pattern,
        custom_weeks=data.custom_weeks,
        scheduling_type=data.scheduling_type,
        fixed_day=data.fixed_day,
        fixed_start_time=data.fixed_start_time,
        fixed_end_time=data.fixed_end_time,
        preferred_days=data.preferred_days,
        avoid_days=data.avoid_days,
        priority=data.priority,
        remarks=data.remarks,
        source_file="Manual Entry",
        source_row_no=None,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session_to_dict(session)


@router.put("/sessions/{session_id}")
def update_session(session_id: int, data: SessionInput, db: DbSession = Depends(get_db)):
    session = db.query(Session).filter_by(id=session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    prog_id, mod_id, group_id, staff_id = upsert_session_dependencies(db, data)

    session.requirement_id = data.requirement_id
    session.programme_id = prog_id
    session.module_id = mod_id
    session.student_group_id = group_id
    session.staff_id = staff_id
    session.class_type = data.class_type
    session.delivery_mode = data.delivery_mode
    session.campus_mode = data.campus_mode
    session.venue_type_required = data.venue_type_required
    session.duration_minutes = data.duration_minutes
    session.sessions_per_week = data.sessions_per_week
    session.exact_class_size = data.exact_class_size
    session.start_week = data.start_week
    session.end_week = data.end_week
    session.week_pattern = data.week_pattern
    session.custom_weeks = data.custom_weeks
    session.scheduling_type = data.scheduling_type
    session.fixed_day = data.fixed_day
    session.fixed_start_time = data.fixed_start_time
    session.fixed_end_time = data.fixed_end_time
    session.preferred_days = data.preferred_days
    session.avoid_days = data.avoid_days
    session.priority = data.priority
    session.remarks = data.remarks

    db.commit()
    db.refresh(session)
    return session_to_dict(session)


@router.delete("/sessions/{session_id}")
def delete_session(session_id: int, db: DbSession = Depends(get_db)):
    session = db.query(Session).filter_by(id=session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Delete related scheduled_sessions before deleting the session
    db.query(ScheduledSession).filter_by(session_id=session_id).delete()
    
    db.delete(session)
    db.commit()
    return {"message": "Session deleted successfully"}

