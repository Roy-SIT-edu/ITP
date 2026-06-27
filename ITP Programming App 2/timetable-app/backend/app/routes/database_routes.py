"""Database management API routes for split reference tables.

These endpoints power the Database tab: list rows, inline CRUD, Excel replace
uploads, and live example workbook downloads.
"""

from typing import Any
from zipfile import BadZipFile

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl.utils.exceptions import InvalidFileException
from pydantic import RootModel
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app.services.database_service import DatabaseService, DatabaseValidationError

router = APIRouter(prefix="/api/database", tags=["database"])
service = DatabaseService()


class DatabaseRowPayload(RootModel[dict[str, Any]]):
    """Accepts the existing raw JSON object shape while giving FastAPI a typed body."""


@router.get("/types")
def database_types():
    return service.types()


@router.get("/{data_type}")
def database_rows(data_type: str, db: DbSession = Depends(get_db)):
    try:
        return service.list_rows(db, data_type)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{data_type}")
def create_database_row(data_type: str, payload: DatabaseRowPayload, db: DbSession = Depends(get_db)):
    try:
        return service.create_row(db, data_type, payload.root)
    except KeyError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (ValueError, DatabaseValidationError) as exc:
        db.rollback()
        detail = exc.errors if isinstance(exc, DatabaseValidationError) else str(exc)
        raise HTTPException(status_code=400, detail=detail) from exc


@router.put("/{data_type}/{row_id}")
def update_database_row(data_type: str, row_id: int, payload: DatabaseRowPayload, db: DbSession = Depends(get_db)):
    try:
        return service.update_row(db, data_type, row_id, payload.root)
    except KeyError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (ValueError, DatabaseValidationError) as exc:
        db.rollback()
        detail = exc.errors if isinstance(exc, DatabaseValidationError) else str(exc)
        raise HTTPException(status_code=400, detail=detail) from exc


@router.delete("/{data_type}/{row_id}")
def delete_database_row(data_type: str, row_id: int, db: DbSession = Depends(get_db)):
    try:
        return service.delete_row(db, data_type, row_id)
    except KeyError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DatabaseValidationError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=exc.errors) from exc


@router.post("/{data_type}/upload")
async def upload_database_type(
    data_type: str,
    file: UploadFile = File(...),
    db: DbSession = Depends(get_db),
):
    try:
        return service.replace_from_excel(db, data_type, await file.read())
    except KeyError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DatabaseValidationError as exc:
        db.rollback()
        return {
            "rows_read": 0,
            "rows_imported": 0,
            "rows_failed": len(exc.errors),
            "errors": exc.errors,
        }
    except (BadZipFile, InvalidFileException, OSError, ValueError) as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Could not read database workbook: {exc}") from exc


@router.get("/{data_type}/example.xlsx")
def database_example(data_type: str, db: DbSession = Depends(get_db)):
    return _database_workbook_response(data_type, db, f"{data_type}-example.xlsx")


@router.get("/{data_type}/current.xlsx")
def database_current_input_workbook(data_type: str, db: DbSession = Depends(get_db)):
    return _database_workbook_response(data_type, db, f"{data_type}-current-input.xlsx")


def _database_workbook_response(data_type: str, db: DbSession, filename: str):
    try:
        buffer = service.example_workbook(db, data_type)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
