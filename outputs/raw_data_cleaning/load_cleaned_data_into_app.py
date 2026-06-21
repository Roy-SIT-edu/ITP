from __future__ import annotations

import json
import sys
from pathlib import Path

from sqlalchemy import func


ROOT = Path(r"C:/Users/Admin/Desktop/Code/Codes/INF1009/ITP")
BACKEND = ROOT / "ITP Programming App 2" / "timetable-app" / "backend"
DATA_JSON = ROOT / "outputs" / "raw_data_cleaning" / "cleaned_raw_data.json"

sys.path.insert(0, str(BACKEND))

from app.database import SessionLocal, create_db_and_seed  # noqa: E402
from app.models.module import Module  # noqa: E402
from app.models.programme import Programme  # noqa: E402
from app.models.room import Room  # noqa: E402
from app.models.staff import Staff  # noqa: E402


def upsert_by_field(db, model, field_name: str, rows: list[dict], columns: list[str]) -> dict:
    created = 0
    updated = 0
    for row in rows:
        key_value = row[field_name]
        item = (
            db.query(model)
            .filter(func.lower(getattr(model, field_name)) == str(key_value).lower())
            .first()
        )
        if item is None:
            item = model()
            db.add(item)
            created += 1
        else:
            updated += 1
        for column in columns:
            setattr(item, column, row.get(column))
    return {"created": created, "updated": updated}


def main() -> None:
    create_db_and_seed()
    payload = json.loads(DATA_JSON.read_text(encoding="utf-8"))
    db = SessionLocal()
    try:
        results = {
            "programmes": upsert_by_field(
                db,
                Programme,
                "code",
                payload["programmes"],
                ["code", "name", "years"],
            ),
            "modules": upsert_by_field(
                db,
                Module,
                "module_code",
                payload["modules"],
                ["module_code", "module_host_key", "module_title", "term"],
            ),
            "staff": upsert_by_field(
                db,
                Staff,
                "staff_id",
                payload["staff"],
                ["staff_id", "staff_name", "staff_host_key"],
            ),
            "rooms": upsert_by_field(
                db,
                Room,
                "room_code",
                payload["rooms"],
                [
                    "room_code",
                    "room_name",
                    "room_type",
                    "capacity",
                    "is_virtual",
                    "campus_mode",
                    "recording_available",
                ],
            ),
        }
        db.commit()
        counts = {
            "programmes": db.query(Programme).count(),
            "modules": db.query(Module).count(),
            "staff": db.query(Staff).count(),
            "rooms": db.query(Room).count(),
        }
        print(json.dumps({"upsert": results, "counts": counts}, indent=2))
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
