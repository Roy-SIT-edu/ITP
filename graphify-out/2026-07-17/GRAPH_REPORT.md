# Graph Report - ITP  (2026-07-17)

## Corpus Check
- 169 files · ~213,945 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1718 nodes · 4668 edges · 90 communities (73 shown, 17 thin omitted)
- Extraction: 79% EXTRACTED · 21% INFERRED · 0% AMBIGUOUS · INFERRED: 997 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e03e828e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 58
- RequirementsEditor.tsx
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- main
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Timetable Scheduling System
- test_session_crud.py
- ensure_programme_year_groups
- Backend README
- Frontend README
- main
- AGENTS.md
- ScheduleService
- ResultParser
- eslint-plugin-react-refresh

## God Nodes (most connected - your core abstractions)
1. `Session` - 114 edges
2. `ScheduledSession` - 105 edges
3. `clean_text()` - 65 edges
4. `Room` - 64 edges
5. `ImportService` - 60 edges
6. `AcademicCalendarService` - 56 edges
7. `RequirementInputService` - 55 edges
8. `DatabaseService` - 53 edges
9. `TimeSlot` - 49 edges
10. `LabRequirementService` - 49 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `create_db_and_seed()`  [INFERRED]
  outputs/raw_data_cleaning/load_cleaned_data_into_app.py → ITP Programming App 2/timetable-app/backend/app/database.py
- `main()` --indirect_call--> `ConstraintViolation`  [INFERRED]
  outputs/raw_data_cleaning/replace_app_data_with_raw_only.py → ITP Programming App 2/timetable-app/backend/app/models/constraint_violation.py
- `main()` --indirect_call--> `Room`  [INFERRED]
  outputs/raw_data_cleaning/load_cleaned_data_into_app.py → ITP Programming App 2/timetable-app/backend/app/models/room.py
- `main()` --indirect_call--> `Room`  [INFERRED]
  outputs/raw_data_cleaning/replace_app_data_with_raw_only.py → ITP Programming App 2/timetable-app/backend/app/models/room.py
- `main()` --indirect_call--> `ScheduleRun`  [INFERRED]
  outputs/raw_data_cleaning/replace_app_data_with_raw_only.py → ITP Programming App 2/timetable-app/backend/app/models/schedule_run.py

## Import Cycles
- None detected.

## Communities (90 total, 17 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.19
Nodes (6): ExcelFile, DatabaseService, DatabaseTypeConfig, BytesIO, DataFrame, DbSession

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (28): _active_week_set(), delivery_room_compatible(), intervals_overlap(), is_face_to_face_mode(), is_online_mode(), normalize_token(), parse_custom_weeks(), parse_day_list() (+20 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (38): AcademicWeek, Base, Persistent academic calendar week definitions., PublicHoliday, Base, Singapore public holidays used as blocked timetable dates., Base, Dated occurrences derived from a generated weekly timetable. (+30 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (51): compareSchedules(), getQuickFixAvailability(), getRooms(), getSchedule(), getScheduledSessionMoveOptions(), getScheduleExplanations(), getScheduleRuns(), getViolations() (+43 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (58): getSession(), recheckSchedule(), MoveControls(), Props, addDays(), firstScheduledWeek(), isLabRequirement(), parseDateInput() (+50 more)

### Community 5 - "Community 5"
Cohesion: 0.17
Nodes (16): importEditedTemplateRows(), resetRequirementInputs(), uploadTemplate(), formatApiError(), databaseItems, Layout(), Props, workflowItems (+8 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (26): BinaryIO, demo_samples(), EditableImportInput, EditableImportRow, import_edited_input_template(), load_demo_sample(), preview_input_template(), BaseModel (+18 more)

### Community 7 - "Community 7"
Cohesion: 0.21
Nodes (26): _apply_programme_years(), _clean_staff_name(), _get_or_create(), _int_or_default(), _programme_codes(), DataFrame, DbSession, Path (+18 more)

### Community 8 - "Community 8"
Cohesion: 0.05
Nodes (40): buildExample(), colLetter(), examples, optionalHeaders, readmeRows, requiredHeaders, writeSheet(), addDataSheet() (+32 more)

### Community 9 - "Community 9"
Cohesion: 0.08
Nodes (39): constraint_insights(), create_session(), delete_session(), get_session(), modules(), programmes(), ConstraintViolation, DbSession (+31 more)

### Community 10 - "Community 10"
Cohesion: 0.09
Nodes (39): generateSchedule(), getDefaultPlanningPeriod(), getSoftConstraintPriorities(), normalizeSoftConstraintPriority(), updateSoftConstraintPriorities(), AutoDeconflictStatusProps, GenerationActionPanel(), GenerationReadinessPanel() (+31 more)

### Community 11 - "Community 11"
Cohesion: 0.10
Nodes (28): _copy_legacy_rows(), Module, Base, Programme, Base, Base, SessionStaff, Base (+20 more)

### Community 12 - "Community 12"
Cohesion: 0.18
Nodes (36): Document, add_api_integration(), add_appendix(), add_architecture(), add_bullets(), add_callout(), add_code_block(), add_constraint_audit() (+28 more)

### Community 13 - "Community 13"
Cohesion: 0.15
Nodes (8): time_to_minutes(), ConstraintViolation, DbSession, Room, TimeSlot, QuickFixService, Quick-fix suggestions for generated timetable conflicts., Classify every time-only move using the same rules as final validation.

### Community 14 - "Community 14"
Cohesion: 0.07
Nodes (22): _create_split_tables(), _drop_column_if_exists(), _ensure_column(), _ensure_programme_years_column(), _ensure_session_lab_columns(), _ensure_soft_constraint_active_column(), _ensure_split_schema(), get_db() (+14 more)

### Community 15 - "Community 15"
Cohesion: 0.06
Nodes (25): Props, academicYears, ImportSummary(), PopoverPosition, Props, Availability, AvailabilityEntry, DatabaseColumn (+17 more)

### Community 16 - "Community 16"
Cohesion: 0.11
Nodes (13): datetime, SQLAlchemy model for generated timetable run metadata., Return a UTC timestamp compatible with the existing SQLite column., utc_now(), Academic calendar generation, holiday blocking, and dated occurrences., BytesIO, DbSession, Administrative schedule-run reporting and PDF rendering. (+5 more)

### Community 17 - "Community 17"
Cohesion: 0.38
Nodes (15): add_bullets(), add_callout(), add_numbers(), add_para(), add_table(), main(), make_doc(), presentation_and_poster() (+7 more)

### Community 18 - "Community 18"
Cohesion: 0.12
Nodes (21): Base, Room, Base, TimeSlot, BuiltModel, test_manual_move_blocks_hard_conflict_and_keeps_original_slot(), Tests for one-click timetable quick-fix suggestions., test_quick_fix_suggests_clean_room_change_for_room_conflict() (+13 more)

### Community 19 - "Community 19"
Cohesion: 0.12
Nodes (9): CpSatTimetableSolver, CpSolver, Room, TimeSlot, CP-SAT solver facade for timetable generation.  This class keeps solver setup sm, CpSolver, Converts selected CP-SAT variables into persisted schedule rows., ResultParser (+1 more)

### Community 20 - "Community 20"
Cohesion: 0.31
Nodes (5): Base, SoftConstraintPriority, DbSession, Soft-constraint priority configuration for solver scoring., SoftConstraintPriorityService

### Community 21 - "Community 21"
Cohesion: 0.24
Nodes (10): ConflictTable(), Props, QuickFixState, quickFixStateLabel(), quickFixStateTitle(), violations, CONFLICT_PRESENTATION, conflictPresentation (+2 more)

### Community 22 - "Community 22"
Cohesion: 0.08
Nodes (25): compilerOptions, allowJs, allowSyntheticDefaultImports, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+17 more)

### Community 23 - "Community 23"
Cohesion: 0.09
Nodes (24): exportUrl(), getConstraintInsights(), getDashboard(), getLatestSchedule(), result(), ActivityKind, icons, InlineActivity() (+16 more)

### Community 24 - "Community 24"
Cohesion: 0.16
Nodes (25): Assert-NodeRuntime(), Ensure-BackendEnvironment(), Ensure-FrontendEnvironment(), Get-BackendPort(), Get-FrontendPort(), Get-NpmCommand(), Get-RuntimeVersion(), Get-SystemPython() (+17 more)

### Community 25 - "Community 25"
Cohesion: 0.16
Nodes (10): Base, ScheduledSession, availability(), Room, TimeSlot, ConstraintService, DbSession, Room (+2 more)

### Community 26 - "Community 26"
Cohesion: 0.17
Nodes (10): LabOverlap, LabOverlapService, DbSession, Detect and resolve fixed lab-to-lab resource overlaps for a schedule run.  Lab, Apply and report the minimum final-schedule exclusions for lab overlaps., _add_star_overlap_run(), ScheduleRun, Regression tests for minimum fixed-lab exclusion plans. (+2 more)

### Community 27 - "Community 27"
Cohesion: 0.27
Nodes (9): App(), currentRoute(), RouteKey, routeMap, applyTheme(), initializeTheme(), storedTheme(), ThemeMode (+1 more)

### Community 28 - "Community 28"
Cohesion: 0.13
Nodes (15): scheduleReportPdfUrl(), emptyFilter, formatCode(), formatDateTime(), labOverlapResources(), labOverlapSessionLabel(), matchesSessionFilter(), reportRunId() (+7 more)

### Community 29 - "Community 29"
Cohesion: 0.17
Nodes (6): CpModel, Room, TimeSlot, Builds the OR-Tools CP-SAT model for timetable assignments.  Each boolean variab, TimetableModelBuilder, LinearExpr

### Community 30 - "Community 30"
Cohesion: 0.16
Nodes (23): AutoDeconflictService, DbSession, Create a derived run by moving only flexible sessions to reduce hard conflicts., _create_conflicting_run(), _prepare_sessions(), Regression tests for safe auto-deconflict schedule derivation., _room(), _slot() (+15 more)

### Community 31 - "Community 31"
Cohesion: 0.21
Nodes (14): ApiError, ConflictSessions, QuickEditValues, QuickSuggestion, ValidationIssueRow, formatIssueType(), ISSUE_LABELS, labelForStatus() (+6 more)

### Community 32 - "Community 32"
Cohesion: 0.18
Nodes (13): Base, Session, session_label(), staff_label(), student_group_label(), DbSession, Validation service for saved requirements and generated schedule quality.  Uploa, ValidationService (+5 more)

### Community 33 - "Community 33"
Cohesion: 0.27
Nodes (17): _client_for(), TestClient, Tests for split database APIs, example files, and schedule compatibility., _route_db(), test_dashboard_reports_latest_scheduled_coverage(), test_database_crud_and_dependency_blocking(), test_database_current_workbook_contains_live_data(), test_database_metadata_exposes_controls_and_rejects_bad_values() (+9 more)

### Community 34 - "Community 34"
Cohesion: 0.28
Nodes (17): clean_common_modules(), clean_modules(), clean_programmes(), clean_rooms(), clean_staff(), clean_staff_name(), clean_text(), host_programme() (+9 more)

### Community 35 - "Community 35"
Cohesion: 0.15
Nodes (9): LabRequirement, Base, clean_text(), LabRequirementService, DbSession, Room, Synchronize built-in lab requirements into solver-ready session rows., Create/update generated lab sessions and return active lab requirement IDs. (+1 more)

### Community 36 - "Community 36"
Cohesion: 0.06
Nodes (34): 10. Lab overlap policy, 11. Review and correction interface, 12. Reporting and export, 13. API behavior and error semantics, 14. Windows launcher, 15. Dependency and quality policy, 16. Test strategy, 17. Data safety and limitations (+26 more)

### Community 37 - "Community 37"
Cohesion: 0.14
Nodes (27): autoDeconflict(), createPublicHoliday(), createSession(), deletePublicHoliday(), deleteSession(), getAcademicCalendarContext(), getAcademicYears(), getAvailability() (+19 more)

### Community 38 - "Community 38"
Cohesion: 0.13
Nodes (15): eslint, devDependencies, eslint, prettier, @testing-library/jest-dom, @testing-library/react, @testing-library/user-event, @types/react-dom (+7 more)

### Community 39 - "Community 39"
Cohesion: 0.25
Nodes (14): create_database_row(), database_current_input_workbook(), database_example(), database_rows(), database_types(), _database_workbook_response(), DatabaseRowPayload, delete_database_row() (+6 more)

### Community 40 - "Community 40"
Cohesion: 0.11
Nodes (27): createDatabaseRow(), databaseCurrentInputUrl(), deleteDatabaseRow(), getDatabaseRows(), getDatabaseTypes(), updateDatabaseRow(), uploadDatabaseFile(), Props (+19 more)

### Community 41 - "Community 41"
Cohesion: 0.15
Nodes (9): FastAPI, lifespan(), FastAPI application entrypoint.  This file wires middleware, API routers, databa, latest_validation(), DbSession, API route for reporting current saved requirement and schedule issues., Tests for export route gatekeeping., test_export_route_blocks_runs_with_hard_conflicts() (+1 more)

### Community 42 - "Community 42"
Cohesion: 0.19
Nodes (12): room_capacity_fits(), candidate_room_allowed(), effective_scheduling_type(), Room, Shared timetable compatibility rules.  The validator and CP-SAT model builder bo, Return whether automatic placement changes must preserve this session., Expose the source scheduling intent shown to administrators., Return whether a saved requirement can be assigned to a room. (+4 more)

### Community 43 - "Community 43"
Cohesion: 0.31
Nodes (10): collectColumns(), DEFAULT_COLUMNS, groupIssuesByRow(), ImportPreviewGrid(), issueKey(), issuesForCell(), issuesForRow(), normalizeField() (+2 more)

### Community 44 - "Community 44"
Cohesion: 0.40
Nodes (10): _build_engines(), create_db_and_seed(), create_session_factory(), dispose_engines(), Path, _routing_session_class(), _sqlite_engine(), test_raw_data_workbook_seeds_matching_reference_tables() (+2 more)

### Community 45 - "Community 45"
Cohesion: 0.53
Nodes (9): _create_run(), Tests for post-generation constraint detection., _room(), _slot(), test_capacity_mismatch_detected(), test_online_session_in_physical_room_detected(), test_room_double_booking_detected(), test_staff_double_booking_detected() (+1 more)

### Community 46 - "Community 46"
Cohesion: 0.12
Nodes (42): HTTPException, ConstraintViolation, Base, Base, ScheduleRun, dashboard(), auto_deconflict_schedule(), compare_schedules() (+34 more)

### Community 47 - "Community 47"
Cohesion: 0.22
Nodes (9): scripts, build, dev, format, format:check, lint, preview, test (+1 more)

### Community 48 - "Community 48"
Cohesion: 0.39
Nodes (7): _client_for(), TestClient, API coverage for rolling calendar resolution and administrator overrides., test_calendar_week_and_holiday_overrides_are_editable(), test_context_api_blocks_non_teaching_week(), test_context_api_generates_future_provisional_calendar(), test_generation_requires_and_persists_selected_planning_period()

### Community 49 - "Community 49"
Cohesion: 0.25
Nodes (7): compilerOptions, allowSyntheticDefaultImports, composite, module, moduleResolution, include, vite.config.ts

### Community 50 - "Community 50"
Cohesion: 0.10
Nodes (16): _ensure_run(), export_csv(), export_xlsx(), DbSession, ScheduleRun, API route for exporting generated schedules as CSV or Excel., ExportService, BytesIO (+8 more)

### Community 51 - "Community 51"
Cohesion: 0.29
Nodes (7): dependencies, lucide-react, react, react-dom, lucide-react, react, react-dom

### Community 52 - "Community 52"
Cohesion: 0.22
Nodes (6): canonical_day(), canonical_delivery_mode(), canonical_week_pattern(), minutes_to_time(), Any, ValueError

### Community 53 - "Community 53"
Cohesion: 0.19
Nodes (22): new_template_row(), Path, Shared pytest fixtures and workbook helpers for backend tests., valid_row(), write_template(), write_two_tab_template(), Tests for strict requirements import validation and rollback behavior., test_blank_source_row_no_falls_back_to_excel_row() (+14 more)

### Community 54 - "Community 54"
Cohesion: 0.33
Nodes (4): outputDir, previewDir, root, scriptDir

### Community 55 - "Community 55"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 58 - "Community 58"
Cohesion: 0.22
Nodes (8): ConstraintPresetValues, ConstraintStudio(), requirementLabel(), RequirementFormData, campusModeForDelivery(), emptySession, Props, SessionRow

### Community 59 - "RequirementsEditor.tsx"
Cohesion: 0.38
Nodes (6): BaseModel, DbSession, API routes for ranking soft constraints before timetable generation., soft_constraint_priorities(), SoftConstraintPriorityInput, update_soft_constraint_priorities()

### Community 66 - "main"
Cohesion: 0.42
Nodes (9): _client_for(), TestClient, Tests for requirements workbook upload routes., _route_db(), test_demo_sample_workbooks_import_expected_workflows(), test_upload_route_combines_multiple_workbooks(), test_upload_route_imports_valid_workbook(), test_upload_route_rejects_duplicate_requirement_ids_across_workbooks() (+1 more)

### Community 80 - "Timetable Scheduling System"
Cohesion: 0.13
Nodes (14): API Endpoints, Current Capabilities, Database Schema, Generation Modes, Known Limitations, Manual Start, Quick Start on Windows, Run Locally (+6 more)

### Community 81 - "test_session_crud.py"
Cohesion: 0.41
Nodes (12): _client_for(), TestClient, Tests for manual requirement CRUD and strict reference validation., _route_db(), test_create_session(), test_create_session_blocks_duplicate_requirement_id(), test_create_session_blocks_missing_reference(), test_delete_session() (+4 more)

### Community 83 - "Backend README"
Cohesion: 0.25
Nodes (7): Backend README, Excel Import, Notes, Run Tests, Setup, Structure, Uploaded Sessions and Fixed Labs

### Community 84 - "Frontend README"
Cohesion: 0.33
Nodes (5): Build, Configuration, Frontend README, Pages, Setup

### Community 85 - "main"
Cohesion: 0.29
Nodes (7): next_student_group_partition(), normalize_student_group_ids(), DbSession, Helpers for maintaining programme/year student-group partitions., Compact student-group IDs to 1..N and remap requirement references., student_group_code(), student_group_partition()

### Community 87 - "ScheduleService"
Cohesion: 0.20
Nodes (11): affected_session_count(), Any, Display-only schedule quality scoring for admin-facing summaries., schedule_quality_from_violations(), schedule_quality_summary(), _violation_value(), generation_timeout_seconds(), DbSession (+3 more)

## Knowledge Gaps
- **212 isolated node(s):** `name`, `private`, `version`, `type`, `build` (+207 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Session` connect `Community 32` to `Community 0`, `Community 1`, `Community 2`, `Community 6`, `Community 7`, `Community 9`, `Community 11`, `Community 14`, `Community 18`, `Community 19`, `Community 26`, `Community 29`, `Community 30`, `Community 33`, `Community 35`, `Community 42`, `Community 45`, `Community 46`, `Community 50`, `Community 53`, `main`, `test_session_crud.py`, `ScheduleService`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Why does `Room` connect `Community 18` to `Community 0`, `Community 1`, `Community 2`, `Community 6`, `Community 7`, `Community 9`, `Community 11`, `Community 13`, `Community 14`, `Community 19`, `Community 25`, `Community 26`, `Community 29`, `Community 30`, `Community 32`, `Community 33`, `Community 35`, `Community 44`, `Community 45`, `Community 46`, `Community 50`, `ScheduleService`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Why does `ScheduledSession` connect `Community 25` to `Community 33`, `Community 2`, `Community 9`, `Community 11`, `Community 13`, `Community 46`, `Community 14`, `Community 16`, `Community 45`, `Community 50`, `Community 18`, `ScheduleService`, `Community 26`, `Community 30`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Are the 68 inferred relationships involving `Session` (e.g. with `dashboard()` and `delete_session()`) actually correct?**
  _`Session` has 68 INFERRED edges - model-reasoned connections that need verification._
- **Are the 48 inferred relationships involving `ScheduledSession` (e.g. with `_copy_legacy_rows()` and `availability()`) actually correct?**
  _`ScheduledSession` has 48 INFERRED edges - model-reasoned connections that need verification._
- **Are the 57 inferred relationships involving `clean_text()` (e.g. with `._assign_lab_requirement_ids()` and `._bool_value()`) actually correct?**
  _`clean_text()` has 57 INFERRED edges - model-reasoned connections that need verification._
- **Are the 62 inferred relationships involving `Room` (e.g. with `_copy_legacy_rows()` and `rooms()`) actually correct?**
  _`Room` has 62 INFERRED edges - model-reasoned connections that need verification._