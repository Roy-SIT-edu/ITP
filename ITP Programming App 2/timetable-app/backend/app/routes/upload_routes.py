from zipfile import BadZipFile

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from openpyxl.utils.exceptions import InvalidFileException
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app.services.import_service import ImportService

router = APIRouter(prefix="/api/upload", tags=["upload"])


@router.post("/input-template")
async def upload_input_template(
    file: UploadFile = File(...),
    db: DbSession = Depends(get_db),
):
    try:
        summary = ImportService().import_upload(db, file.file, file.filename or "input-template.xlsx")
        return summary
    except (BadZipFile, InvalidFileException, OSError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not read timetable workbook: {exc}",
        ) from exc
