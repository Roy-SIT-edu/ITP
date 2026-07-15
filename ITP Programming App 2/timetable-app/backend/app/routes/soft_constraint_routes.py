"""API routes for ranking soft constraints before timetable generation."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app.services.soft_constraint_priority_service import SoftConstraintPriorityService

router = APIRouter(prefix="/api/soft-constraints", tags=["soft-constraints"])


class SoftConstraintPriorityInput(BaseModel):
    ordered_codes: list[str]
    active_codes: list[str] | None = None


@router.get("")
def soft_constraint_priorities(db: DbSession = Depends(get_db)):
    return SoftConstraintPriorityService().list_priorities(db)


@router.put("")
def update_soft_constraint_priorities(data: SoftConstraintPriorityInput, db: DbSession = Depends(get_db)):
    try:
        return SoftConstraintPriorityService().update_priorities(db, data.ordered_codes, data.active_codes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
