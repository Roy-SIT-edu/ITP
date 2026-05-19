from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app.services.import_service import ImportService

router = APIRouter(prefix="/api/upload", tags=["upload"])


@router.post("/input-template")
async def upload_input_template(
    file: UploadFile = File(...),
    db: DbSession = Depends(get_db),
):
    summary = ImportService().import_upload(db, file.file, file.filename or "input-template.xlsx")
    return summary
