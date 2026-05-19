from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app.services.validation_service import ValidationService

router = APIRouter(prefix="/api/validation", tags=["validation"])


@router.get("/latest")
def latest_validation(db: DbSession = Depends(get_db)):
    return ValidationService().validate_latest(db)
