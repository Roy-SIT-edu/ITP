"""API route for exporting generated schedules as CSV or Excel."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app.models.schedule_run import ScheduleRun
from app.services.export_service import ExportService

router = APIRouter(prefix="/api/export", tags=["export"])


def _ensure_run(db: DbSession, schedule_run_id: int) -> None:
    if not db.query(ScheduleRun).filter_by(id=schedule_run_id).first():
        raise HTTPException(status_code=404, detail={"message": "Schedule run not found"})


@router.get("/{schedule_run_id}/csv")
def export_csv(schedule_run_id: int, db: DbSession = Depends(get_db)):
    _ensure_run(db, schedule_run_id)
    buffer = ExportService().csv_buffer(db, schedule_run_id)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=timetable_run_{schedule_run_id}.csv"},
    )


@router.get("/{schedule_run_id}/xlsx")
def export_xlsx(schedule_run_id: int, db: DbSession = Depends(get_db)):
    _ensure_run(db, schedule_run_id)
    buffer = ExportService().xlsx_buffer(db, schedule_run_id)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=timetable_run_{schedule_run_id}.xlsx"},
    )
