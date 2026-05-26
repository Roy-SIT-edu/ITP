from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(r"C:/Users/Admin/Desktop/Code/Codes/INF1009/ITP")
BACKEND = ROOT / "ITP Programming App 2" / "timetable-app" / "backend"
DATA_JSON = ROOT / "outputs" / "raw_data_cleaning" / "cleaned_raw_data.json"

sys.path.insert(0, str(BACKEND))

from app.database import SessionLocal  # noqa: E402
from app.models.constraint_violation import ConstraintViolation  # noqa: E402
from app.models.module import Module  # noqa: E402
from app.models.programme import Programme  # noqa: E402
from app.models.room import Room  # noqa: E402
from app.models.schedule_run import ScheduleRun  # noqa: E402
from app.models.scheduled_session import ScheduledSession  # noqa: E402
from app.models.session import Session as Requirement  # noqa: E402
from app.models.staff import Staff  # noqa: E402
from app.models.student_group import StudentGroup  # noqa: E402
from app.models.time_slot import TimeSlot  # noqa: E402


def bulk_insert(db, model, rows: list[dict]) -> None:
    db.add_all(model(**row) for row in rows)


def main() -> None:
    payload = json.loads(DATA_JSON.read_text(encoding="utf-8"))
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
    main()
