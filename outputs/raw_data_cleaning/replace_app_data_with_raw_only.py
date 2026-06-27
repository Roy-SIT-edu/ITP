from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_ROOT = Path(os.environ.get("ITP_ROOT", SCRIPT_DIR.parents[1]))


def bulk_insert(db, model, rows: list[dict]) -> None:
    db.add_all(model(**row) for row in rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Replace app data with cleaned raw reference data only.")
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="Project root containing the timetable app.")
    parser.add_argument("--data-json", type=Path, default=None, help="Path to cleaned_raw_data.json.")
    parser.add_argument(
        "--confirm-replace",
        action="store_true",
        help="Required. Confirms destructive deletion and replacement of app database rows.",
    )
    return parser.parse_args()


def main(root: Path, data_json: Path, confirm_replace: bool) -> None:
    if not confirm_replace:
        raise SystemExit("Refusing to replace database rows without --confirm-replace.")

    backend = root / "ITP Programming App 2" / "timetable-app" / "backend"
    if str(backend) not in sys.path:
        sys.path.insert(0, str(backend))

    from app.database import SessionLocal
    from app.models.constraint_violation import ConstraintViolation
    from app.models.module import Module
    from app.models.programme import Programme
    from app.models.room import Room
    from app.models.schedule_run import ScheduleRun
    from app.models.scheduled_session import ScheduledSession
    from app.models.session import Session as Requirement
    from app.models.staff import Staff
    from app.models.student_group import StudentGroup
    from app.models.time_slot import TimeSlot

    payload = json.loads(data_json.read_text(encoding="utf-8"))
    db = SessionLocal()
    try:
        for model in [
            ConstraintViolation,
            ScheduledSession,
            ScheduleRun,
            Requirement,
            StudentGroup,
            TimeSlot,
            Room,
            Staff,
            Module,
            Programme,
        ]:
            db.query(model).delete(synchronize_session=False)

        bulk_insert(db, Programme, payload["programmes"])
        bulk_insert(db, Module, payload["modules"])
        bulk_insert(db, Staff, payload["staff"])
        bulk_insert(db, Room, payload["rooms"])

        db.commit()
        counts = {
            "rooms": db.query(Room).count(),
            "staff": db.query(Staff).count(),
            "modules": db.query(Module).count(),
            "programmes": db.query(Programme).count(),
            "student_groups": db.query(StudentGroup).count(),
            "time_slots": db.query(TimeSlot).count(),
            "requirements": db.query(Requirement).count(),
            "schedule_runs": db.query(ScheduleRun).count(),
        }
        print(json.dumps(counts, indent=2))
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    args = parse_args()
    main(
        args.root,
        args.data_json or args.root / "outputs" / "raw_data_cleaning" / "cleaned_raw_data.json",
        args.confirm_replace,
    )
