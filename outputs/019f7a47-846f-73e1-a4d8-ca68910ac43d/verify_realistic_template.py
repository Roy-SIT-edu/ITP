from __future__ import annotations

import json
import pathlib
import re
import shutil
import sqlite3
import sys
import tempfile
from contextlib import closing


BACKEND_ROOT = pathlib.Path(sys.argv[1])
WORKBOOK_PATH = pathlib.Path(sys.argv[2])
EXPECTED_PATH = pathlib.Path(sys.argv[3])
sys.path.insert(0, str(BACKEND_ROOT))

from app import models  # noqa: E402,F401
from app.database import DATA_DIR, SPLIT_DATABASE_FILES, create_session_factory, dispose_engines  # noqa: E402
from app.models.constraint_violation import ConstraintViolation  # noqa: E402
from app.models.lab_requirement import LabRequirement  # noqa: E402
from app.models.module import Module  # noqa: E402
from app.models.scheduled_session import ScheduledSession  # noqa: E402
from app.models.session import Session  # noqa: E402
from app.models.student_group import StudentGroup  # noqa: E402
from app.services.import_service import ImportService  # noqa: E402
from app.services.schedule_service import ScheduleService  # noqa: E402
from app.services.validation_service import ValidationService  # noqa: E402
from sqlalchemy import func  # noqa: E402


expected = json.loads(EXPECTED_PATH.read_text(encoding="utf-8-sig"))
summary = expected["summary"]
expected_row_count = int(summary["input_row_count"])
expected_programmes = set(summary["programmes"])
expected_modules = {
    programme: set(module_codes)
    for programme, module_codes in summary["programme_modules"].items()
}


def clone_current_databases(destination: pathlib.Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    for filename in SPLIT_DATABASE_FILES.values():
        with (
            closing(sqlite3.connect(DATA_DIR / filename)) as source,
            closing(sqlite3.connect(destination / filename)) as target,
        ):
            source.backup(target)


def validate_scenario(include_fixed_labs: bool) -> dict:
    prefix = "realistic-template-combined-" if include_fixed_labs else "realistic-template-only-"
    temp_dir = pathlib.Path(tempfile.mkdtemp(prefix=prefix))
    engines = None
    db = None
    try:
        clone_current_databases(temp_dir)
        Factory, engines = create_session_factory(temp_dir)
        db = Factory()

        if not include_fixed_labs:
            db.query(LabRequirement).delete(synchronize_session=False)
            db.commit()

        clean_admin_groups = {
            row.group_code: {"id": row.id, "size": int(row.size or 0), "year": int(row.year or 0)}
            for row in db.query(StudentGroup).filter(StudentGroup.id <= 228).all()
        }
        module_codes_before = {row.module_code for row in db.query(Module).all()}
        group_count_before = db.query(StudentGroup).count()
        module_count_before = db.query(Module).count()

        for row in expected["required"]:
            group_code = row["Student Group Code"]
            group = clean_admin_groups.get(group_code)
            if not group:
                raise SystemExit(f"Workbook uses a non-admin or generated group: {group_code}")
            if re.search(r"\sP5[1-5]$", group_code, flags=re.IGNORECASE):
                raise SystemExit(f"Workbook uses a forbidden P51-P55 group: {group_code}")
            if int(row["Exact Class Size"]) != group["size"]:
                raise SystemExit(f"Class size does not match admin group {group_code}.")
            if row["Module Code"] not in module_codes_before:
                raise SystemExit(f"Workbook module is not in the current admin module database: {row['Module Code']}")

        imported = ImportService().import_input_template(db, WORKBOOK_PATH)
        if imported["rows_failed"] != 0 or imported["rows_imported"] != expected_row_count:
            raise SystemExit(f"Import failed: {json.dumps(imported.get('errors', [])[:20])}")
        if db.query(StudentGroup).count() != group_count_before:
            raise SystemExit("Import created a student group; all groups must be admin-defined before import.")
        if db.query(Module).count() != module_count_before:
            raise SystemExit("Import created a module; all modules must exist in the admin database before import.")

        validation = ValidationService().validate_latest(db)
        if validation["error_count"] != 0 or validation["warning_count"] != 0:
            raise SystemExit(
                "Saved-data validation failed: "
                + json.dumps(
                    {
                        "errors": validation["errors"][:20],
                        "warnings": validation["warnings"][:20],
                    }
                )
            )

        uploaded = db.query(Session).filter(Session.is_lab_requirement.is_(False)).all()
        if len(uploaded) != expected_row_count:
            raise SystemExit(f"Expected {expected_row_count} uploaded sessions; found {len(uploaded)}.")

        programme_modules: dict[str, set[str]] = {}
        class_types: set[str] = set()
        delivery_modes: set[str] = set()
        admin_group_ids = {item["id"] for item in clean_admin_groups.values()}
        for item in uploaded:
            programme_modules.setdefault(item.programme.code, set()).add(item.module.module_code)
            class_types.add(item.class_type)
            delivery_modes.add(item.delivery_mode)
            if item.student_group_id not in admin_group_ids:
                raise SystemExit(f"Imported session {item.requirement_id} does not use a clean admin group.")
            if re.search(r"\sP5[1-5]$", item.student_group.group_code, flags=re.IGNORECASE):
                raise SystemExit(f"Imported session {item.requirement_id} uses a forbidden P51-P55 group.")
            if int(item.exact_class_size or 0) != int(item.student_group.size or 0):
                raise SystemExit(f"Imported session {item.requirement_id} has a group-size mismatch.")

        actual_programmes = set(programme_modules)
        if actual_programmes != expected_programmes:
            raise SystemExit(f"Programme coverage mismatch: {sorted(actual_programmes)}")
        for programme, modules_expected in expected_modules.items():
            if programme_modules.get(programme) != modules_expected:
                raise SystemExit(
                    f"Module coverage mismatch for {programme}: {sorted(programme_modules.get(programme, set()))}"
                )
        invalid_class_types = [
            value
            for value in class_types
            if value.casefold().startswith("online") or "lab" in value.casefold()
        ]
        if invalid_class_types:
            raise SystemExit(f"Invalid uploaded class types: {sorted(invalid_class_types)}")

        generation = ScheduleService().generate(
            db,
            academic_year="2025/26",
            trimester=3,
            timeout=300.0,
            fast_mode=True,
            reproducible=True,
        )
        if generation["solver_status"] not in {"OPTIMAL", "FEASIBLE"}:
            raise SystemExit(f"Schedule generation failed: {json.dumps(generation)}")
        if int(generation["hard_violation_count"]) != 0:
            raise SystemExit(f"Schedule generation stored hard conflicts: {json.dumps(generation)}")

        run_id = generation["schedule_run_id"]
        stored_hard = (
            db.query(ConstraintViolation)
            .filter(
                ConstraintViolation.schedule_run_id == run_id,
                func.upper(ConstraintViolation.severity) == "HARD",
            )
            .count()
        )
        if stored_hard != 0:
            raise SystemExit(f"Schedule run {run_id} contains {stored_hard} stored hard conflict(s).")
        # ScheduledSession and Session live in separate SQLite files. Resolve
        # IDs in two routed queries instead of issuing an unsupported SQL join.
        scheduled_session_ids = [
            row.session_id
            for row in db.query(ScheduledSession)
            .filter(
                ScheduledSession.schedule_run_id == run_id,
                ScheduledSession.included_in_final.is_(True),
            )
            .all()
        ]
        scheduled_uploaded = (
            db.query(Session)
            .filter(
                Session.id.in_(scheduled_session_ids),
                Session.is_lab_requirement.is_(False),
            )
            .count()
            if scheduled_session_ids
            else 0
        )
        if scheduled_uploaded != expected_row_count:
            raise SystemExit(
                f"Only {scheduled_uploaded}/{expected_row_count} uploaded requirements appear in the final timetable."
            )

        post = ValidationService().validate_latest(db)
        if post["schedule_issues"]["hard_count"] != 0:
            raise SystemExit(f"Post-generation validation found hard conflicts: {json.dumps(post['schedule_issues'])}")

        active_lab_count = db.query(Session).filter(Session.is_lab_requirement.is_(True)).count()
        return {
            "scenario": "combined_with_fixed_labs" if include_fixed_labs else "template_only",
            "import": {
                "rows_read": imported["rows_read"],
                "rows_imported": imported["rows_imported"],
                "rows_failed": imported["rows_failed"],
                "student_groups_created": db.query(StudentGroup).count() - group_count_before,
                "modules_created": db.query(Module).count() - module_count_before,
            },
            "saved_data_validation": {
                "is_valid": validation["is_valid"],
                "error_count": validation["error_count"],
                "warning_count": validation["warning_count"],
            },
            "coverage": {
                "programme_count": len(programme_modules),
                "minimum_distinct_modules_per_programme": min(len(values) for values in programme_modules.values()),
                "class_types": sorted(class_types),
                "delivery_modes": sorted(delivery_modes),
                "clean_admin_group_count_used": len({item.student_group_id for item in uploaded}),
                "forbidden_p51_p55_count": 0,
            },
            "schedule_generation": {
                "solver_status": generation["solver_status"],
                "hard_violation_count": generation["hard_violation_count"],
                "stored_hard_conflict_count": stored_hard,
                "post_validation_hard_count": post["schedule_issues"]["hard_count"],
                "soft_warning_count": generation["soft_warning_count"],
                "uploaded_requirements_scheduled": scheduled_uploaded,
                "active_fixed_lab_session_count": active_lab_count,
                "excluded_lab_session_count": generation.get("excluded_lab_session_count", 0),
                "generation_seconds": generation.get("generation_seconds"),
                "message": generation.get("message"),
            },
        }
    finally:
        if db is not None:
            db.close()
        if engines is not None:
            dispose_engines(engines)
        shutil.rmtree(temp_dir, ignore_errors=True)


result = {
    "template_only": validate_scenario(include_fixed_labs=False),
    "combined_with_fixed_labs": validate_scenario(include_fixed_labs=True),
}
print(json.dumps(result))
