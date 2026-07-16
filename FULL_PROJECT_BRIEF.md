# Timetable Scheduling System — Full Project Brief

Last updated: 16 July 2026

## 1. Project purpose

This project is a local, single-user academic timetable management system. It converts uploaded scheduling requirements and database-held lab requirements into a reviewable timetable, identifies hard conflicts and soft quality warnings, supports manual and automatic correction, records separate schedule versions, produces detailed reports, and exports an approved final schedule.

The central design principle is that the system must not hide scheduling problems. Initial generation preserves supplied fixed timings, reports any remaining hard conflicts to the administrator, and blocks final export until the final included schedule has no hard conflicts.

## 2. Intended users and operating context

- Primary user: a timetable administrator.
- Platform: Windows desktop, launched locally from a `.cmd` file.
- Deployment model: one user and one local application instance.
- Security model: no authentication; development and preview servers bind to localhost.
- Storage: split local SQLite databases.
- Data source: Excel input requirements plus reference and lab data maintained in the application database.

This is not designed as a public multi-user web service. Production concurrency, authentication, roles, and remote hosting are outside the present scope.

## 3. Technology stack

### Backend

- Python 3.10–3.14
- FastAPI and Uvicorn
- SQLAlchemy
- Google OR-Tools CP-SAT
- pandas and openpyxl for workbook processing
- ReportLab for PDF reports
- pytest and Ruff for development checks

### Frontend

- React 19
- TypeScript
- Vite
- Vitest and Testing Library
- ESLint and Prettier

### Persistence

The backend uses one SQLAlchemy session with model-specific SQLite binds:

- `rooms.db`
- `staff.db`
- `programmes.db`
- `modules.db`
- `student_groups.db`
- `time_slots.db`
- `requirements.db`
- `schedule_state.db`

The legacy `timetable.db` is used only as a migration source when the split stores are empty.

## 4. End-to-end workflow

1. The administrator maintains rooms, staff, programmes, modules, student groups, and database lab requirements.
2. The administrator uploads the Excel input template, loads a demo, or enters flexible requirements in the application.
3. The system previews the input and runs reference, field, and scheduling-consistency validation.
4. The administrator corrects invalid rows before generation.
5. The system combines uploaded requirements with the database lab requirements.
6. The solver first attempts a strict schedule that respects all fixed timings and hard constraints.
7. If a fully strict solution cannot be produced, the system creates a reviewable result through relaxed or greedy recovery while still preserving fixed timings.
8. The system detects hard conflicts and soft warnings and records them against the schedule run.
9. The review page lets the administrator inspect conflicts by severity and type, view explanations, apply available quick fixes, or manually edit placements.
10. Auto-deconflict can create a separate derived schedule version and move only non-lab sessions when a safe placement reduces the hard-conflict count.
11. Fixed lab-to-lab overlaps are resolved for the final schedule by excluding the minimum deterministic set of lab assignments. The lab requirement records and their scheduled audit rows are retained.
12. The report records detected lab overlap pairs and identifies which lab sessions were excluded from the final schedule.
13. Export is permitted only when the included final schedule has zero hard conflicts.

## 5. Requirement ownership and fixed-session policy

There are two important sources of requirements:

### Uploaded Excel requirements

Uploaded rows may contain fixed day and time data. When complete fixed timing is supplied, generation treats that timing as fixed on the first run. It is not silently downgraded to flexible. A fixed clash therefore remains visible for administrator review.

New and corrected requirements created through the current general-purpose application editors are saved as flexible. This prevents those editors from creating new fixed rows accidentally; fixed timing supplied by the supported import remains honoured.

### Database lab requirements

Generated lab sessions are fixed and immovable. Their source records, fixed day, fixed start/end times, room requirements, staff, and group data are not rewritten by generation or auto-deconflict.

## 6. Solver concept

A constraint solver searches combinations of session, time slot, and room. For every compatible combination, the CP-SAT model can create a Boolean decision variable:

```text
x[session_id, time_slot_id, room_id] = 1
```

The value is 1 when that placement is selected. Each session must receive exactly one selected placement.

### Hard constraints

Hard constraints describe conditions that should not be violated in a fully valid timetable:

- one placement per session;
- no conflicting room use;
- no conflicting staff use;
- no conflicting student-group use;
- sufficient room capacity;
- physical/online delivery compatibility;
- required venue/room compatibility;
- fixed day and fixed time preservation;
- hard-priority avoided days.

### Soft constraints

Soft constraints guide schedule quality but do not block export. Current examples include:

- preferred-day placement;
- soft avoided days;
- online teaching outside preferred weekdays;
- long tutor idle gaps;
- short campus days;
- long consecutive teaching periods;
- undesirable online/face-to-face adjacency.

Administrators can rank or disable soft constraints. Their weights influence which otherwise valid timetable the solver prefers.

## 7. Why strict, relaxed, and greedy paths exist

### Strict CP-SAT

Strict mode is always the first scheduling attempt. It is the evidence that all modelled hard rules can be met simultaneously. A successful result is the preferred outcome.

### Relaxed CP-SAT recovery

If the strict model proves infeasible, a relaxed model allows selected resource overlaps to produce a complete, inspectable timetable. Fixed timing is still preserved. The resulting hard violations are explicitly detected after solving and shown to the administrator.

This recovery path is necessary because returning no timetable gives the administrator little practical information about where the input conflicts occur.

### Greedy fallback

Greedy scheduling is a deterministic emergency path used when a known fixed clash exists, the strict solver times out, or recovery cannot produce a solution. It schedules the most constrained and fixed sessions first, ranks candidate placements, and heavily penalises resource conflicts.

Greedy is not presented as proof of optimality. Its purpose is to produce a reviewable result quickly while preserving the input evidence and surfacing conflicts.

## 8. User-selectable generation modes

The user-facing modes control the CP-SAT search, not the meaning of hard constraints:

- **Standard:** multiple workers and a shorter time allowance, optimised for normal interactive use.
- **Reproducible:** one worker, a fixed seed, and a longer allowance, intended for repeatable demonstrations, tests, and result comparison.

Both modes use strict-first generation and the same recovery hierarchy.

## 9. Auto-deconflict behavior

Auto-deconflict is a post-generation correction operation exposed at:

```text
POST /api/schedules/{schedule_run_id}/auto-deconflict
```

It accepts `timeout_seconds`, defaulting to 30 seconds with an allowed range of 1–120 seconds.

The operation:

- requires a completed run with assignments and at least one hard conflict;
- creates a new derived schedule run;
- leaves the source run and requirement records unchanged;
- never moves database lab sessions;
- evaluates shared slot, room, delivery, capacity, staff, and group compatibility rules;
- considers the sessions with the fewest valid placements first, then session ID;
- ranks placements by retaining the same day, time, and room where possible, followed by stable identifiers;
- keeps a move only when it reduces the hard-conflict count;
- commits the best safe derived version if the time limit expires;
- rolls back the complete derived run on unexpected failure.

The API reports:

- source and derived schedule run IDs;
- moved session count;
- remaining hard-violation count;
- whether the time limit was reached;
- unresolved fixed/lab session IDs;
- lab overlap and final-exclusion information.

The frontend reports actual elapsed activity and the returned outcome. It does not invent solver percentages or estimated remaining time for this operation.

## 10. Lab overlap policy

Lab requirements are special because they are pre-specified institutional records and must not be moved automatically.

Current checking policy:

- lab-to-lab room, staff, and group overlaps are handled by final-schedule exclusion rather than movement;
- lab-to-normal-session room, staff, or group clashes remain hard conflicts;
- generated lab source timing and records remain unchanged;
- excluded lab assignments remain stored for audit and reporting;
- only included assignments appear in the final schedule and export.

For a graph of overlapping lab sessions, the system solves a minimum vertex-cover-style optimisation: every overlap edge must have at least one endpoint excluded, and the objective first minimises the number of excluded sessions. A stable ID-based tie-breaker makes equivalent minimum solutions deterministic.

This satisfies the requirement to remove the fewest lab sessions from the final timetable without deleting the lab requirements from the database.

## 11. Review and correction interface

The review page provides:

- run/version selection;
- hard-conflict and soft-warning counts;
- conflict type filtering;
- stable conflict sorting;
- affected-class and raw-conflict views;
- schedule explanations (“Why This Schedule?”);
- quick-fix availability checks;
- manual placement editing;
- auto-deconflict outcome reporting;
- report and export access.

A quick-fix button is enabled only when the backend confirms that a compatible improvement exists. Unavailable actions are labelled and disabled rather than failing after a misleading click.

Manual changes and quick fixes trigger rechecking and refresh the schedule, violations, explanations, comparisons, and quick-fix availability.

## 12. Reporting and export

Each schedule run has an HTML report and a PDF report. The report covers:

- quality summary;
- hard and soft conflict totals;
- detailed violation rows;
- workload and timetable information;
- every scheduled assignment;
- fixed lab overlap pairs;
- shared room/staff/group resources causing each lab overlap;
- the minimum set of lab sessions excluded from the final schedule.

CSV/XLSX exports filter on `included_in_final`. Excluded lab assignments remain in the database and report but are omitted from the approved final template.

Export remains blocked while hard conflicts exist in the included final schedule. Therefore an exported final Template 2 represents a zero-hard-conflict included timetable.

## 13. API behavior and error semantics

Important schedule endpoints include:

- `POST /api/schedules/generate`
- `POST /api/schedules/{id}/auto-deconflict`
- `GET /api/schedules/{id}`
- `GET /api/schedules/{id}/violations`
- `GET /api/schedules/{id}/explanations`
- `GET /api/schedules/{id}/quick-fix-availability`
- `PUT /api/schedules/{id}/sessions/{session_id}`
- `POST /api/schedules/{id}/suggest-fixes`
- `POST /api/schedules/{id}/recheck`
- `GET /api/schedules/{id}/report`
- `GET /api/schedules/{id}/report.pdf`
- `GET /api/export/{id}/csv`
- `GET /api/export/{id}/xlsx`

Auto-deconflict returns 404 for a missing run and 409 when a run is running/failed, contains no assignments, or contains no hard conflicts.

## 14. Windows launcher

The supported Windows entry point is:

```text
ITP Programming App 2/timetable-app/Launch Timetable Scheduler.cmd
```

No compiled executable is required. The `.cmd` invokes `quicklaunch.ps1`, which:

- resolves paths relative to its own location, including folders containing spaces;
- accepts supported Python 3.10–3.14 installations;
- detects and rebuilds an incompatible or damaged local virtual environment;
- installs the fully hashed production dependency lock only when its hash changes;
- requires a Vite-compatible Node runtime (20.19+ or 22.12+);
- discovers npm rather than assuming one fixed installation path;
- runs `npm ci` when the frontend lock changes;
- binds services to `127.0.0.1`;
- reuses healthy existing application services;
- falls back to later ports when the default ports are occupied;
- uses application-specific health checks;
- prints useful startup logs if a process exits or times out;
- checks the split SQLite databases and preserves the full set before rebuilding if corruption is proven.

The shutdown script identifies this application’s backend/frontend processes and does not terminate unrelated Python or Node processes.

## 15. Dependency and quality policy

- Production dependencies are declared in `backend/requirements.in` and compiled to a fully pinned, hashed `requirements.txt`.
- Development requirements are declared in `backend/requirements-dev.in` and compiled to `requirements-dev.txt`.
- pytest, httpx, and Ruff are development-only dependencies.
- The launcher installs the production lock with hash enforcement.
- Backend CI/development installs the development lock.
- Frontend dependencies are installed reproducibly from `package-lock.json`.
- Formatting-only changes should be kept logically separate from functional changes during review.

## 16. Test strategy

### Backend

Backend coverage includes:

- import preview, validation, and rollback;
- split-database routing;
- session CRUD and reference validation;
- strict, relaxed, and greedy generation behavior;
- fixed timing preservation;
- lab generation and lab overlap exclusion;
- deterministic auto-deconflict;
- timeout and rollback behavior;
- source-run immutability;
- quick fixes and manual edits;
- reports and exports;
- API error responses.

Commands:

```powershell
cd "ITP Programming App 2\timetable-app\backend"
venv\Scripts\python.exe -m ruff format --check .
venv\Scripts\python.exe -m ruff check .
venv\Scripts\python.exe -m pytest
venv\Scripts\python.exe -m pip check
```

### Frontend

Frontend coverage includes API calls, auto-deconflict status states, loading, success, unavailable quick fixes, unresolved conflicts, and failure handling.

Commands:

```powershell
cd "ITP Programming App 2\timetable-app\frontend"
npm run format:check
npm run test:run
npm run lint
npm run build
```

### Launcher

`scripts/windows-launcher-smoke.ps1` checks cold/repeat start, service identity, health, automatic port fallback, and scoped shutdown behavior.

## 17. Data safety and limitations

- Back up all split SQLite files as one consistent set before deployment or manual data replacement.
- Do not copy only one database while WAL/SHM files are active.
- Auto-deconflict creates a new run and does not mutate its source run.
- Lab exclusion does not delete a lab requirement or its audit assignment.
- Previously cleared fixed timing cannot be inferred safely; restore it from the original workbook or a database backup.
- Solver work currently runs inside a synchronous API request, so generation progress is an estimate rather than a live CP-SAT event stream.
- No authentication or multi-user concurrency protection is present.

## 18. Current presentation narrative

The project can be presented as five connected technical contributions:

1. **Reliable data ingestion:** structured Excel import, editable preview, reference validation, and split persistence.
2. **Explainable constraint scheduling:** strict CP-SAT first, explicit recovery paths, hard/soft separation, and reproducible mode.
3. **Administrator-controlled correction:** transparent conflicts, manual editing, truthful quick-fix availability, and derived auto-deconflict versions.
4. **Auditable lab conflict handling:** immutable lab requirements, minimum final-schedule exclusions, zero-hard-conflict export, and overlap reporting.
5. **Operational reliability:** local-only binding, reproducible dependency locks, virtual-environment repair, health-aware startup, database preservation, and scoped shutdown.

The strongest demonstration is an end-to-end run: upload a workbook containing fixed input conflicts, generate the initial reviewable timetable, inspect the reported conflicts, apply manual or automatic correction, show the separate version, open the lab-overlap report, and export the zero-hard-conflict final template.

## 19. Repository map

```text
ITP Programming App 2/timetable-app/
  backend/
    app/models/          SQLAlchemy entities
    app/routes/          FastAPI endpoints
    app/services/        validation, scheduling, reporting, correction
    app/solver/          CP-SAT model, solver facade, result parsing
    app/tests/           backend automated tests
    data/                local split SQLite runtime data
  frontend/
    src/components/      reusable UI and conflict components
    src/pages/           workflow pages
    src/services/        API client
    src/styles/          application styles
  scripts/               launcher smoke tests and utilities
  quicklaunch.ps1        hardened Windows launcher implementation
  Launch Timetable Scheduler.cmd
  Stop Timetable Scheduler.cmd
outputs/final_presentation_docs/
  01_Full_Technical_Breakdown.docx
  02_Presentation_and_Poster_Content.docx
  03_Presentation_Split_Equal_Technical_Contribution.docx
  build_project_documents.py
  build_technical_guidebook.py
FULL_PROJECT_BRIEF.md
```

## 20. Recommended future work

- Background solver jobs with backend-reported progress and cancellation.
- Authentication, administrator roles, and audit attribution.
- More explicit common-module/shared-session modelling.
- Staff and room unavailability calendars.
- A versioned downstream Template 2 export contract test.
- A database backup/restore screen.
- Deployment profiles for a true multi-user database if the system scope expands.
