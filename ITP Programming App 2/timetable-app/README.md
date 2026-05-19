# Timetable Scheduling System

Working full-stack prototype for importing academic timetable requirements, validating them, generating a CP-SAT schedule, reviewing conflicts, and exporting the result.

## Stack

- Backend: FastAPI, SQLAlchemy, SQLite, pandas/openpyxl, Google OR-Tools CP-SAT
- Frontend: React, TypeScript, Vite
- Database: local SQLite file at `backend/timetable.db`

## Run Locally

### Quick Start on Windows

Prerequisites:

- Python 3.10 or newer
- Node.js 20 or newer, including npm

From a fresh clone, double-click:

```text
Launch Timetable Scheduler.cmd
```

Or run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\quicklaunch.ps1
```

The quicklaunch script creates `backend\venv` when missing, installs backend packages from `backend\requirements.txt`, installs frontend packages with `npm ci`, starts both servers, avoids ports already used by other processes, and opens the app in your browser. If the default ports are busy, it automatically tries the next available ports starting from:

- Backend: http://127.0.0.1:8001
- Frontend: http://127.0.0.1:5174

### Manual Start

Backend:

```powershell
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Frontend:

```powershell
cd frontend
npm install
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
- `GET /api/schedules/{schedule_run_id}/violations`
- `GET /api/export/{schedule_run_id}/csv`
- `GET /api/export/{schedule_run_id}/xlsx`

## Database Schema

Core tables:

- `programmes`: programme code, name, cluster
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

## Tests

```powershell
cd backend
pytest
```

Coverage includes import validation, hard constraint detection, solver feasibility, infeasible capacity, and invalid fixed-time handling.

Frontend build check:

```powershell
cd frontend
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
