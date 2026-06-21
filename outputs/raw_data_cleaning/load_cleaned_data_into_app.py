from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from sqlalchemy import func


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_ROOT = Path(os.environ.get("ITP_ROOT", SCRIPT_DIR.parents[1]))


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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Upsert cleaned reference data into the timetable app database.")
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="Project root containing the timetable app.")
    parser.add_argument("--data-json", type=Path, default=None, help="Path to cleaned_raw_data.json.")
    return parser.parse_args()


def main(root: Path, data_json: Path) -> None:
    backend = root / "ITP Programming App 2" / "timetable-app" / "backend"
    if str(backend) not in sys.path:
        sys.path.insert(0, str(backend))

    from app.database import SessionLocal, create_db_and_seed
    from app.models.module import Module
    from app.models.programme import Programme
    from app.models.room import Room
    from app.models.staff import Staff

    create_db_and_seed()
    payload = json.loads(data_json.read_text(encoding="utf-8"))
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
    args = parse_args()
    main(args.root, args.data_json or args.root / "outputs" / "raw_data_cleaning" / "cleaned_raw_data.json")
