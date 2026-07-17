"""Academic calendar, rolling trimester, holiday, and occurrence APIs."""

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app.models.academic_week import AcademicWeek
from app.models.public_holiday import PublicHoliday
from app.models.session_occurrence import SessionOccurrence
from app.services.academic_calendar_service import AcademicCalendarService

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


class AcademicWeekUpdate(BaseModel):
    start_date: date
    end_date: date
    phase: Literal["STUDY", "RECESS", "FINAL_ASSESSMENT", "TRIMESTER_BREAK"]
    notes: str | None = None
    is_provisional: bool = False


class PublicHolidayInput(BaseModel):
    date: date
    name: str
    is_observed: bool = False


@router.get("/context")
def calendar_context(
    selected_date: date = Query(alias="date"),
    schedule_run_id: int | None = None,
    db: DbSession = Depends(get_db),
):
    try:
        result = AcademicCalendarService().context(db, selected_date, schedule_run_id)
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/academic-years")
def academic_years(db: DbSession = Depends(get_db)):
    rows = db.query(AcademicWeek).order_by(AcademicWeek.start_date).all()
    result: dict[str, dict] = {}
    for row in rows:
        item = result.setdefault(
            row.academic_year,
            {
                "academic_year": row.academic_year,
                "start_date": row.start_date.isoformat(),
                "end_date": row.end_date.isoformat(),
                "is_provisional": row.is_provisional,
                "trimesters": [],
            },
        )
        item["start_date"] = min(item["start_date"], row.start_date.isoformat())
        item["end_date"] = max(item["end_date"], row.end_date.isoformat())
        item["is_provisional"] = item["is_provisional"] or row.is_provisional
        if row.trimester not in item["trimesters"]:
            item["trimesters"].append(row.trimester)
    return list(result.values())


@router.get("/planning-period-default")
def default_planning_period(db: DbSession = Depends(get_db)):
    result = AcademicCalendarService().next_planning_period(db)
    db.commit()
    return result


@router.get("/weeks")
def calendar_weeks(
    academic_year: str | None = None,
    trimester: int | None = Query(default=None, ge=1, le=3),
    db: DbSession = Depends(get_db),
):
    query = db.query(AcademicWeek)
    if academic_year:
        query = query.filter(AcademicWeek.academic_year == academic_year)
    if trimester:
        query = query.filter(AcademicWeek.trimester == trimester)
    service = AcademicCalendarService()
    rows = query.order_by(AcademicWeek.start_date).all()
    return [
        service.week_to_dict(
            row,
            db.query(PublicHoliday).filter(PublicHoliday.date >= row.start_date, PublicHoliday.date <= row.end_date).all(),
        )
        for row in rows
    ]


@router.put("/weeks/{week_id}")
def update_calendar_week(week_id: int, data: AcademicWeekUpdate, db: DbSession = Depends(get_db)):
    if data.end_date < data.start_date:
        raise HTTPException(status_code=400, detail="Academic week end date cannot be before its start date.")
    week = db.query(AcademicWeek).filter_by(id=week_id).first()
    if week is None:
        raise HTTPException(status_code=404, detail="Academic week not found.")
    week.start_date = data.start_date
    week.end_date = data.end_date
    week.phase = data.phase
    week.notes = data.notes
    week.is_provisional = data.is_provisional
    db.query(SessionOccurrence).delete(synchronize_session=False)
    db.commit()
    return AcademicCalendarService().week_to_dict(week)


@router.get("/holidays")
def public_holidays(year: int | None = None, db: DbSession = Depends(get_db)):
    query = db.query(PublicHoliday)
    if year is not None:
        query = query.filter(PublicHoliday.date >= date(year, 1, 1), PublicHoliday.date <= date(year, 12, 31))
    return [AcademicCalendarService().holiday_to_dict(item) for item in query.order_by(PublicHoliday.date).all()]


@router.post("/holidays")
def create_public_holiday(data: PublicHolidayInput, db: DbSession = Depends(get_db)):
    if not data.name.strip():
        raise HTTPException(status_code=400, detail="Public holiday name is required.")
    if db.query(PublicHoliday).filter_by(date=data.date).first():
        raise HTTPException(status_code=409, detail="A public holiday already exists on that date.")
    item = PublicHoliday(
        date=data.date,
        name=data.name.strip(),
        is_observed=data.is_observed,
        source="Manual override",
        is_manual_override=True,
    )
    db.add(item)
    db.query(SessionOccurrence).delete(synchronize_session=False)
    db.commit()
    db.refresh(item)
    return AcademicCalendarService().holiday_to_dict(item)


@router.put("/holidays/{holiday_id}")
def update_public_holiday(holiday_id: int, data: PublicHolidayInput, db: DbSession = Depends(get_db)):
    if not data.name.strip():
        raise HTTPException(status_code=400, detail="Public holiday name is required.")
    item = db.query(PublicHoliday).filter_by(id=holiday_id).first()
    if item is None:
        raise HTTPException(status_code=404, detail="Public holiday not found.")
    duplicate = db.query(PublicHoliday).filter(PublicHoliday.date == data.date, PublicHoliday.id != holiday_id).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="A public holiday already exists on that date.")
    item.date = data.date
    item.name = data.name.strip()
    item.is_observed = data.is_observed
    item.source = "Manual override"
    item.is_manual_override = True
    db.query(SessionOccurrence).delete(synchronize_session=False)
    db.commit()
    return AcademicCalendarService().holiday_to_dict(item)


@router.delete("/holidays/{holiday_id}")
def delete_public_holiday(holiday_id: int, db: DbSession = Depends(get_db)):
    item = db.query(PublicHoliday).filter_by(id=holiday_id).first()
    if item is None:
        raise HTTPException(status_code=404, detail="Public holiday not found.")
    db.delete(item)
    db.query(SessionOccurrence).delete(synchronize_session=False)
    db.commit()
    return {"message": "Public holiday removed."}
