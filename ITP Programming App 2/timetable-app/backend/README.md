# Backend README

FastAPI backend for the timetable scheduling prototype.

## Setup

```powershell
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The API runs on http://localhost:8000 and creates `timetable.db` automatically.

## Structure

- `app/main.py`: FastAPI app, CORS, router registration
- `app/database.py`: SQLite engine, sessions, startup seeding
- `app/models/`: SQLAlchemy models
- `app/routes/`: HTTP endpoints
- `app/services/import_service.py`: Excel import
- `app/services/validation_service.py`: pre-solver validation
- `app/services/schedule_service.py`: generation orchestration
- `app/services/constraint_service.py`: post-solve checks
- `app/services/export_service.py`: CSV/XLSX output
- `app/solver/`: CP-SAT model builder, solver runner, result parser
- `app/tests/`: pytest tests

## Excel Import

The importer looks for an `Input_Template` sheet. If it is absent, it reads the first sheet. Column aliases tolerate minor naming differences around the system-ready template fields.

Upload endpoint:

```text
POST /api/upload/input-template
```

## Run Tests

```powershell
pytest
```

## Notes

The backend owns all scheduling logic. React only calls APIs and renders results.
