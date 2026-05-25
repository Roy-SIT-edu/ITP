from zipfile import BadZipFile

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from openpyxl.utils.exceptions import InvalidFileException
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app.services.import_service import ImportService

router = APIRouter(prefix="/api/upload", tags=["upload"])


@router.post("/input-template")
async def upload_input_template(
    files: list[UploadFile] | None = File(None),
    file: UploadFile | None = File(None),
    db: DbSession = Depends(get_db),
):
    try:
        uploads = files or ([] if file is None else [file])
        if not uploads:
            raise HTTPException(status_code=400, detail="Upload at least one requirements workbook.")
        workbooks = [(await item.read(), item.filename or "input-template.xlsx") for item in uploads]
        summary = ImportService().import_input_template_files(db, workbooks)
        return summary
    except (BadZipFile, InvalidFileException, OSError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not read timetable workbook(s): {exc}",
        ) from exc
