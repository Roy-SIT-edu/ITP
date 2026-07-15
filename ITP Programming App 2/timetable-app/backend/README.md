# Backend README

FastAPI backend for the timetable scheduling prototype.

## Setup

For normal Windows use, prefer the repo-level launcher:

```powershell
cd ..
powershell -NoProfile -ExecutionPolicy Bypass -File .\quicklaunch.ps1
```

Manual backend-only setup:

```powershell
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

`requirements.in` is the production source list and `requirements.txt` is its fully pinned, hash-locked output. Development and CI use `requirements-dev.in` and `requirements-dev.txt`; test, HTTP client, and Ruff packages are not installed by the production launcher.

The API runs on http://localhost:8000 and creates the split SQLite databases under `data/` automatically.

## Structure

- `app/main.py`: FastAPI app, CORS, router registration
- `app/database.py`: SQLite engine, sessions, startup seeding
- `app/models/`: SQLAlchemy models
- `app/routes/`: HTTP endpoints
- `app/services/import_service.py`: Excel import
- `app/services/validation_service.py`: pre-solver validation
- `app/services/schedule_service.py`: generation orchestration
- `app/services/auto_deconflict_service.py`: safe deterministic derived-run conflict reduction
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

## Uploaded Sessions and Fixed Labs

Fresh generation preserves the supplied day/time of uploaded requirements marked `Fixed`, allowing unavoidable clashes to appear as hard conflicts for administrator review. The administrator can correct the generated run manually or use Auto Deconflict, which may move uploaded fixed sessions in a derived run without rewriting source requirements. Only sessions synchronized from the Lab Requirements database remain permanently immovable.

The solver retains all fixed lab assignments for audit. After a successful run, room, staff, and student-group overlap pairs are covered by an exact deterministic minimum exclusion set; those selected assignments remain stored but are omitted from the final timetable and exports. Run reports list every pair and exclusion. Per-lab capacity, delivery, required-room, and fixed-time post-checks remain exempt. Lab-to-normal-session clashes remain hard conflicts and continue to block export.

## Notes

The backend owns all scheduling logic. React only calls APIs and renders results.
