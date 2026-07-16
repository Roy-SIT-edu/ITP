# Timetable Scheduling System

Full-stack academic timetable scheduler for importing and editing requirements, validating scheduling inputs, generating an OR-Tools CP-SAT timetable, resolving conflicts, comparing runs, and exporting approved schedules.

## Stack

- Backend: FastAPI, SQLAlchemy, split SQLite storage, pandas/openpyxl, ReportLab, Google OR-Tools CP-SAT
- Frontend: React 19, TypeScript, Vite
- Storage: model-specific SQLite files under `backend/data/`, routed through one SQLAlchemy session

## Run Locally

### Quick Start on Windows

Prerequisites:

- Python 3.10 through 3.14
- Node.js 20.19+ or 22.12+, including npm

From a fresh clone, double-click:

```text
Launch Timetable Scheduler.cmd
```

Or run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\quicklaunch.ps1
```

To start and verify both services without opening a browser:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\quicklaunch.ps1 -NoBrowser
```

The quicklaunch script creates or repairs `backend\venv`, synchronizes the hashed production lock whenever `backend\requirements.txt` changes, installs frontend packages with `npm ci` whenever `package-lock.json` changes, starts both servers, avoids ports already used by other processes, and opens the app in your browser. If the default ports are busy, it automatically tries the next available ports starting from:

- Backend: http://127.0.0.1:8001
- Frontend: http://127.0.0.1:5174

Backend startup can take longer on the first run or inside a synced folder. The launcher waits up to two minutes and prints the startup error automatically if the process exits or remains unavailable. Full output is retained in `backend\quicklaunch-backend-<port>.err.log` and `backend\quicklaunch-backend-<port>.out.log`.

SQLite `.db`, `-wal`, and `-shm` files are local runtime data and must not be committed or copied independently. Before startup, the launcher checks every split database. If corruption is detected, it preserves the complete database set under `backend\database-backups\corrupt-<timestamp>\` and rebuilds clean databases from the available seed data.

### Manual Start

Backend:

```powershell
cd backend
python -m venv venv
venv\Scripts\activate
pip install --require-hashes -r requirements.txt
uvicorn app.main:app --reload
```

Backend checks:

```powershell
cd backend
pip install -r requirements-dev.txt
ruff format --check .
ruff check .
pytest
pip check
```

Frontend:

```powershell
cd frontend
npm ci
npm run dev
```

- Backend: http://localhost:8000
- Frontend: http://localhost:5173
- API docs: http://localhost:8000/docs

When using a non-default backend port, start the frontend with:

```powershell
$env:VITE_PROXY_TARGET="http://127.0.0.1:8001"
npm run dev -- --host 127.0.0.1 --port 5174
```

## Current Capabilities

- Import timetable workbooks with preview, editable rows, validation summaries, and bundled demo samples.
- Manage rooms, staff, programmes, modules, student groups, and lab requirements through tables or XLSX uploads.
- Create, update, and remove individual scheduling requirements in the app.
- Rank or disable soft constraints before generation.
- Generate in fast `Standard` mode or deterministic `Reproducible` mode.
- Track elapsed time, estimated remaining time, and learned runtime estimates from recent runs.
- Review schedules by timetable, affected module, or raw issue, with separate hard-conflict and soft-warning filters.
- Apply validated quick-fix suggestions or manually change a session's staff, delivery details, day, time, and room.
- Compare schedule versions and open a full run report covering quality, workloads, conflicts, and session details.
- Export CSV or XLSX once all hard conflicts are resolved; soft warnings remain optional quality guidance.

## Workflow

1. Maintain reference data and lab requirements in the Database section.
2. Upload `System_Ready_Timetable_Input_Template.xlsx`, load a demo, or enter requirements manually.
3. Preview and correct imported rows, then run input and scheduling-consistency validation.
4. Rank the soft constraints and choose Standard or Reproducible generation in Settings.
5. Generate a timetable while the page displays elapsed and estimated remaining time.
6. Review hard conflicts and soft warnings, then use Quick Fix or edit placements directly.
7. Recheck the run, compare versions, and inspect the full HTML or PDF run report.
8. Export the approved timetable as CSV or XLSX after all hard conflicts are cleared.

On a new data directory, the backend seeds reference data and default time slots. Demo requirement sets can be selected from the upload screen.

## API Endpoints

- `GET /health`
- `POST /api/upload/input-template`
- `POST /api/upload/input-template/preview`
- `POST /api/upload/input-template/edited`
- `GET /api/upload/demo-samples`
- `POST /api/upload/demo-samples/{sample_id}/load`
- `GET /api/validation/latest`
- `GET|POST|PUT|DELETE /api/sessions`
- `GET /api/dashboard`
- `GET /api/availability`
- `GET /api/constraint-insights`
- `GET|PUT /api/soft-constraints`
- `GET|POST|PUT|DELETE /api/database/{data_type}`
- `POST /api/database/{data_type}/upload`
- `POST /api/schedules/generate?mode=standard|reproducible`
- `GET /api/schedules`
- `GET /api/schedules/compare`
- `GET /api/schedules/latest`
- `GET /api/schedules/{schedule_run_id}`
- `POST /api/schedules/{schedule_run_id}/auto-deconflict`
- `PUT /api/schedules/{schedule_run_id}/sessions/{session_id}`
- `GET /api/schedules/{schedule_run_id}/quick-fix-availability`
- `POST /api/schedules/{schedule_run_id}/suggest-fixes`
- `POST /api/schedules/{schedule_run_id}/recheck`
- `GET /api/schedules/{schedule_run_id}/violations`
- `GET /api/schedules/{schedule_run_id}/explanations`
- `GET /api/schedules/{schedule_run_id}/report`
- `GET /api/schedules/{schedule_run_id}/report.pdf`
- `GET /api/export/{schedule_run_id}/csv`
- `GET /api/export/{schedule_run_id}/xlsx`

Interactive API documentation is available at the backend `/docs` URL.

## Database Schema

The app uses SQLAlchemy binds to keep related models in separate files while exposing one application session:

- `rooms.db`: room capacity, venue type, campus, and virtual/physical metadata
- `staff.db`: staff identifiers and host metadata
- `programmes.db`, `modules.db`, `student_groups.db`: academic reference data
- `time_slots.db`: day, time, duration, and weekly/odd/even patterns
- `requirements.db`: imported sessions, co-teachers, and lab requirements
- `schedule_state.db`: runs, assignments, violations, and soft-constraint priorities

The old `backend/timetable.db` is treated only as a legacy migration source when split databases are empty.

## Solver Explanation

The backend uses OR-Tools CP-SAT. For each compatible combination of session, time slot, and room, it creates:

```text
x[session_id, timeslot_id, room_id] = 1
```

Hard constraints:

- Every session is scheduled exactly once.
- Rooms cannot overlap.
- Staff cannot overlap.
- Student groups cannot overlap.
- Room capacity must fit class size.
- Delivery mode must match room virtual/physical type.
- Venue type must match room type.
- Fixed sessions only use the fixed day/time.
- Avoid days are hard only when priority is `Hard`.

Soft penalties:

- Preferred day misses
- Soft avoid-day placement
- Online sessions outside Monday/Tuesday

Post-solve soft warnings include long tutor gaps, short campus days, long consecutive student days, and online/F2F adjacent switches.

### Generation Modes

- `Standard`: eight search workers with a 30-second solver budget. It prioritises speed, so equivalent inputs may produce slightly different valid timetables.
- `Reproducible`: one search worker, a fixed random seed, and a 300-second solver budget for repeatable results from the same inputs.

The generation page begins with a default estimate of 25 seconds for Standard or 120 seconds for Reproducible mode, then averages the last five completed runs per mode. Estimated progress is capped below completion while the solver is running, remains stationary when the request appears stalled, and animates to 100% only after the backend returns.

If the strict model is infeasible, the solver can run its relaxed recovery path so conflicts remain visible and actionable in the review workflow. Hard conflicts block export; soft warnings affect schedule quality but do not block export.

Database lab sessions remain immovable. Lab-to-lab overlaps are recorded in every run report and resolved for the final timetable by excluding the smallest deterministic set of overlapping lab assignments; their database requirements and audit assignments are retained. Lab-to-normal-session clashes remain hard conflicts.

## Tests

```powershell
cd backend
pip install -r requirements-dev.txt
ruff format --check .
ruff check .
pytest
pip check
```

Coverage includes workbook preview/import validation, split database routing and migration, lab requirements, co-teacher clashes, generation modes, hard and soft constraints, quick fixes, manual schedule updates, reports, exports, and infeasible solver cases.

Frontend checks:

```powershell
cd frontend
npm ci
npm run format:check
npm run lint
npm run build
```

## Known Limitations

- Authentication and roles are intentionally not included.
- Uploaded imports replace existing sessions and generated runs.
- Generation runs in a synchronous API request; the progress bar estimates solver progress rather than receiving live CP-SAT callbacks.
- Generation mode and runtime history are stored per browser using local storage.
- Shared-session metadata is imported, but automatic merging of independently entered common-module rows remains limited.
- The application is designed for local single-user operation with SQLite rather than concurrent production deployment.

## Suggested Next Improvements

- Add authentication, roles, and audit attribution.
- Move solver execution to a background job with server-reported progress and cancellation.
- Model shared sessions and combined programme sessions more explicitly.
- Add unavailable staff/room constraints.
- Add export compatibility with the downstream system template.
- Add audit history for multiple import batches.
