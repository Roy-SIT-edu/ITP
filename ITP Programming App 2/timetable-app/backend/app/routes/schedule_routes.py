from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app.models.constraint_violation import ConstraintViolation
from app.models.schedule_run import ScheduleRun
from app.services.export_service import ExportService
from app.services.schedule_service import ScheduleService
from app.services.serializers import schedule_run_to_dict, violation_to_dict

router = APIRouter(prefix="/api/schedules", tags=["schedules"])


@router.post("/generate")
def generate_schedule(db: DbSession = Depends(get_db)):
    result = ScheduleService().generate(db)
    if result.get("error") == "VALIDATION_FAILED":
        raise HTTPException(status_code=400, detail=result)
    return result


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


@router.get("/{schedule_run_id}/violations")
def schedule_violations(schedule_run_id: int, db: DbSession = Depends(get_db)):
    return [
        violation_to_dict(item)
        for item in db.query(ConstraintViolation)
        .filter_by(schedule_run_id=schedule_run_id)
        .order_by(ConstraintViolation.severity, ConstraintViolation.constraint_code)
        .all()
    ]
