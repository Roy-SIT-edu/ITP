# Timetable Scheduling System

Working full-stack prototype for importing academic timetable requirements, validating them, generating a CP-SAT schedule, reviewing conflicts, and exporting the result.

## Stack

- Backend: FastAPI, SQLAlchemy, SQLite, pandas/openpyxl, Google OR-Tools CP-SAT
- Frontend: React, TypeScript, Vite
- Database: local SQLite file at `backend/timetable.db`

## Run Locally

### Quick Start on Windows

Prerequisites:

- Python 3.10 through 3.14
- Node.js 20.19+ or 22.12+ (including npm), as required by Vite 8

From a fresh clone, double-click:

```text
Launch Timetable Scheduler.cmd
```

The `.cmd` file is the supported Windows entry point and works regardless of the caller's current directory or Windows user profile. A compiled `.exe` is not required.

Or run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\quicklaunch.ps1
```

<<<<<<< Updated upstream
The quicklaunch script creates `backend\venv` when missing, installs backend packages from `backend\requirements.txt`, installs frontend packages with `npm ci`, starts both servers, avoids ports already used by other processes, and opens the app in your browser. If the default ports are busy, it automatically tries the next available ports starting from:
=======
To start and verify both services without opening a browser:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\quicklaunch.ps1 -NoBrowser
```

The quicklaunch script creates or repairs `backend\venv`, installs the hash-locked production packages whenever `backend\requirements.txt` changes, synchronizes frontend packages whenever `frontend\package-lock.json` changes, starts both servers, avoids ports already used by other processes, and opens the app in your browser. If the default ports are busy, it automatically tries the next available ports starting from:
>>>>>>> Stashed changes

- Backend: http://127.0.0.1:8001
- Frontend: http://127.0.0.1:5174

<<<<<<< Updated upstream
=======
To stop only this application's backend and frontend processes, double-click `Stop Timetable Scheduler.cmd`.

Backend startup can take longer on the first run or inside a synced folder. The launcher waits up to two minutes and prints the startup error automatically if the process exits or remains unavailable. Full output is retained in `backend\quicklaunch-backend-<port>.err.log` and `backend\quicklaunch-backend-<port>.out.log`.

SQLite `.db`, `-wal`, and `-shm` files are local runtime data and must not be committed or copied independently. Before startup, the launcher checks every split database. If corruption is detected, it preserves the complete database set under `backend\database-backups\corrupt-<timestamp>\` and rebuilds clean databases from the available seed data.

>>>>>>> Stashed changes
### Manual Start

Backend:

```powershell
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
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

`backend/requirements.in` and `backend/requirements-dev.in` are the reviewed source requirements. Their corresponding `requirements.txt` and `requirements-dev.txt` files are fully pinned universal locks with hashes and Python-version markers for 3.10 through 3.14. The launcher installs only the production lock; CI and local quality checks install the development lock.

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

<<<<<<< Updated upstream
=======
## Current Capabilities

- Import timetable workbooks with preview, editable rows, validation summaries, and bundled demo samples.
- Manage rooms, staff, programmes, modules, student groups, and lab requirements through tables or XLSX uploads.
- Create, update, and remove individual scheduling requirements in the app.
- Rank or disable soft constraints before generation.
- Generate in fast `Standard` mode or deterministic `Reproducible` mode.
- Track elapsed time, estimated remaining time, and learned runtime estimates from recent runs.
- Review schedules by timetable, affected module, or raw issue, with separate hard-conflict and soft-warning filters.
- Create a separate, deterministic auto-deconflicted version without changing the source run or requirement records.
- Apply validated quick-fix suggestions or manually change a session's staff, delivery details, day, time, and room.
- Compare schedule versions and open a full run report covering quality, workloads, conflicts, and session details.
- Export CSV or XLSX once all hard conflicts are resolved; soft warnings remain optional quality guidance.

>>>>>>> Stashed changes
## Workflow

1. Upload `System_Ready_Timetable_Input_Template.xlsx`.
2. Rows are imported into relational SQL tables.
3. Validation checks required fields and scheduling consistency.
4. CP-SAT assigns each session to one room and one time slot.
5. Constraint checker verifies hard clashes and soft warnings.
6. React review page displays the timetable, filters, and conflicts.
7. Export generated timetable as CSV or XLSX.

If no upload is available, the backend seeds demo data for DSC, ASE, MDME, rooms, time slots, and sample sessions.

## API Endpoints

- `GET /health`
- `POST /api/upload/input-template`
- `GET /api/validation/latest`
- `GET /api/programmes`
- `GET /api/modules`
- `GET /api/student-groups`
- `GET /api/staff`
- `GET /api/rooms`
- `GET /api/timeslots`
- `GET /api/sessions`
- `GET /api/dashboard`
- `POST /api/schedules/generate`
- `GET /api/schedules/latest`
- `GET /api/schedules/{schedule_run_id}`
<<<<<<< Updated upstream
=======
- `PUT /api/schedules/{schedule_run_id}/sessions/{session_id}`
- `POST /api/schedules/{schedule_run_id}/suggest-fixes`
- `POST /api/schedules/{schedule_run_id}/recheck`
- `POST /api/schedules/{schedule_run_id}/auto-deconflict?timeout_seconds=30`
>>>>>>> Stashed changes
- `GET /api/schedules/{schedule_run_id}/violations`
- `GET /api/export/{schedule_run_id}/csv`
- `GET /api/export/{schedule_run_id}/xlsx`

## Database Schema

Core tables:

- `programmes`: programme code, name, years
- `modules`: module code, host key, title, term
- `student_groups`: group code, programme, year, size
- `staff`: staff name, staff ID, host key
- `rooms`: room code, type, capacity, virtual flag, campus mode
- `time_slots`: day, start, end, duration, week pattern
- `sessions`: imported timetable requirement rows
- `schedule_runs`: generation metadata and solver status
- `scheduled_sessions`: generated room/time assignments
- `constraint_violations`: hard and soft constraint reports

## Solver Explanation

The backend uses OR-Tools CP-SAT. For each compatible combination of session, time slot, and room, it creates:

```text
x[session_id, timeslot_id, room_id] = 1
```

Hard constraints:

- Every requirement receives a stored run assignment; the final timetable may exclude the minimum number of overlapping fixed labs.
- Rooms cannot overlap.
- Staff cannot overlap.
- Student groups cannot overlap.
- Room capacity must fit class size.
- Delivery mode must match room virtual/physical type.
- Venue type must match room type.
- Built-in lab sessions only use the day/time synchronized from the Lab Requirements database.
- Avoid days are hard only when priority is `Hard`.

Fresh generation honors the supplied day and time of Excel rows marked `Fixed`. If fixed uploaded rows clash with each other or with built-in labs, the first run retains those placements and records the resulting hard conflicts so an administrator can review and correct them manually. Excel rows marked `Flexible` are scheduled around the locked first-run placements where possible.

Auto-deconflict creates a separate run, may move uploaded sessions including Excel rows marked `Fixed`, and never changes their source requirements or the source run. Built-in lab sessions remain immovable. Its timeout defaults to 30 seconds and accepts values from 1 to 120 seconds. If the limit is reached, the safest improved version found so far is committed. Remaining hard conflicts stay visible and continue to block export.

After each successful run, fixed lab-to-lab room, staff, and student-group overlaps are converted into a deterministic minimum exclusion plan. The selected lab assignments remain stored on the run and the Lab Requirements database is unchanged, but those assignments are omitted from the final timetable, availability calculations, and CSV/XLSX exports. The JSON, browser, and PDF run reports list every original overlap pair and the lab session excluded for it.

### Lab Exceptions

The current lab rules are intentional:

- The solver may retain lab-to-lab room, staff, and student-group overlaps in its auditable assignment set; finalization excludes the minimum number of lab sessions needed to cover every overlap pair.
- Per-lab capacity, delivery-mode, required-room, and fixed-time post-checks are exempt.
- Lab-to-normal-session room, staff, or student-group clashes remain hard conflicts.
- Generated lab sessions are fixed, so auto-deconflict never moves them.
- Uploaded `Fixed` timings apply to fresh generation only; administrators may move those run assignments manually or use Auto Deconflict.

Soft penalties:

- Preferred day misses
- Soft avoid-day placement
- Online sessions outside Monday/Tuesday

Post-solve soft warnings include long tutor gaps, short campus days, long consecutive student days, and online/F2F adjacent switches.

## Tests

```powershell
cd backend
pip install -r requirements-dev.txt
ruff format --check .
ruff check .
pytest
pip check
```

Coverage includes import validation, hard constraint detection, solver feasibility, infeasible capacity, and invalid fixed-time handling.

Frontend checks:

```powershell
cd frontend
npm ci
npm run format:check
npm run test:run
npm run lint
npm run build
```

## Known Limitations

- Authentication and roles are intentionally not included.
- Uploaded imports replace existing sessions and generated runs.
- Staff 2 is parsed only as source data context; MVP scheduling uses Staff 1.
- Custom week patterns are stored but scheduled using available default slots.
- Advanced common/shared module merging is reserved for later input files.
- Room master imports from raw reference files are not yet wired in.

## Suggested Next Improvements

- Add room/staff/module master import from the supporting files.
- Model shared sessions and combined programme sessions explicitly.
- Add unavailable staff/room constraints.
- Improve custom week overlap logic.
- Add export compatibility with the downstream system template.
- Add audit history for multiple import batches.
