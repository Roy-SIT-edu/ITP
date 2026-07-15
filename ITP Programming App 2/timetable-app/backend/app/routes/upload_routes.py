"""Requirements workbook upload route.

The upload accepts one or more Excel files and delegates validation/import to
ImportService so failed batches leave existing requirements untouched.
"""

from pathlib import Path
from zipfile import BadZipFile

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from openpyxl.utils.exceptions import InvalidFileException
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app.services.import_service import ImportService

router = APIRouter(prefix="/api/upload", tags=["upload"])


DEMO_SAMPLES = {
    "no-constraints": {
        "label": "No constraints",
        "filename": "sample_no_constraints_20_rows.xlsx",
        "description": "Twenty baseline requirement rows with no preferred days, avoid days, or fixed times.",
    },
    "soft-constraints": {
        "label": "Soft constraints only",
        "filename": "sample_soft_constraints_only_20_rows.xlsx",
        "description": "Twenty flexible rows with preferred and avoided teaching days.",
    },
    "hard-constraints": {
        "label": "Fixed timings",
        "filename": "sample_hard_constraints_20_rows.xlsx",
        "description": "Twenty uploaded fixed rows whose timings are honored on the first generated run.",
    },
    "mixed-constraints": {
        "label": "Mixed references and preferences",
        "filename": "sample_mixed_constraints_20_rows.xlsx",
        "description": "Six first-run fixed timings plus fourteen flexible rows with soft preferences.",
    },
}


def _sample_dir() -> Path:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "outputs" / "sample-input-workbooks"
        if candidate.exists():
            return candidate
    raise HTTPException(status_code=404, detail="Sample workbook folder not found.")


def _uploads(files: list[UploadFile] | None, file: UploadFile | None) -> list[UploadFile]:
    uploads = files or ([] if file is None else [file])
    if not uploads:
        raise HTTPException(status_code=400, detail="Upload at least one requirements workbook.")
    return uploads


async def _read_workbooks(files: list[UploadFile] | None, file: UploadFile | None) -> list[tuple[bytes, str]]:
    return [(await item.read(), item.filename or "input-template.xlsx") for item in _uploads(files, file)]


@router.post("/input-template")
async def upload_input_template(
    files: list[UploadFile] | None = File(None),
    file: UploadFile | None = File(None),
    db: DbSession = Depends(get_db),
):
    try:
        return ImportService().import_input_template_files(db, await _read_workbooks(files, file))
    except (BadZipFile, InvalidFileException, OSError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not read timetable workbook(s): {exc}",
        ) from exc


@router.post("/input-template/preview")
async def preview_input_template(
    files: list[UploadFile] | None = File(None),
    file: UploadFile | None = File(None),
    db: DbSession = Depends(get_db),
):
    try:
        return ImportService().preview_input_template_files(db, await _read_workbooks(files, file))
    except (BadZipFile, InvalidFileException, OSError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not read timetable workbook(s): {exc}",
        ) from exc


@router.get("/demo-samples")
def demo_samples():
    sample_dir = _sample_dir()
    return [
        {
            "id": sample_id,
            "available": (sample_dir / sample["filename"]).exists(),
            **sample,
        }
        for sample_id, sample in DEMO_SAMPLES.items()
    ]


@router.post("/demo-samples/{sample_id}/load")
def load_demo_sample(sample_id: str, db: DbSession = Depends(get_db)):
    sample = DEMO_SAMPLES.get(sample_id)
    if not sample:
        raise HTTPException(status_code=404, detail="Sample workbook not found.")
    path = _sample_dir() / sample["filename"]
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Sample file '{sample['filename']}' not found.")
    try:
        return ImportService().import_input_template(db, path, source_filename=sample["filename"])
    except (BadZipFile, InvalidFileException, OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Could not load sample workbook: {exc}") from exc
