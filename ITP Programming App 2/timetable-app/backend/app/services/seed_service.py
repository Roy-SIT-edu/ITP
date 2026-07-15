"""Startup seed data for empty split databases.

Reference data can be populated from the real multi-sheet raw-data workbook.
The scheduler still needs a generated time-slot grid, but demo rooms, staff,
modules, programmes, student groups, and sessions are intentionally not seeded.
"""

from __future__ import annotations

<<<<<<< Updated upstream
=======
import json
>>>>>>> Stashed changes
import re
from pathlib import Path

import pandas as pd
from app.models.module import Module
from app.models.programme import Programme
from app.models.room import Room
from app.models.session import Session
from app.models.staff import Staff
from app.models.student_group import StudentGroup
from app.models.time_slot import TimeSlot
from app.services.compatibility import clean_text, minutes_to_time
from sqlalchemy.orm import Session as DbSession

DEFAULT_RAW_DATA_PATH = Path(__file__).resolve().parents[2] / "data" / "Raw Data.xlsx"

PROGRAMME_NAMES = {
    "AAI": "Applied Artificial Intelligence",
    "ACC": "Accountancy",
    "ASE": "Aircraft Systems Engineering",
    "ATM": "Aviation Management",
    "BAC": "Applied Computing / Applied Computing (Fintech)",
    "BICT": "Business and Infocomm Technology",
    "CDM": "Communication and Digital Media",
    "CEG": "Computer Engineering",
    "CVE": "Civil Engineering",
    "DSC": "Digital Supply Chain",
    "EDE": "Electronics and Data Engineering",
    "EEE": "Electrical and Electronic Engineering",
    "EPE": "Electrical Power Engineering",
    "ESE": "Engineering Systems",
    "FDT": "Food Technology",
    "HTM": "Hospitality and Tourism Management",
    "ICT": "Information and Communications Technology - Information Security / Software Engineering",
    "MDME": "Mechanical Design and Manufacturing Engineering",
    "MEC": "Mechanical Engineering",
    "METS": "Mechatronics Systems",
    "NAME": "Naval Architecture and Marine Engineering",
    "NUR": "Nursing",
    "RSE": "Robotics Systems",
    "RTY": "Radiation Therapy",
    "SBE": "Sustainable Built Environment",
    "SLT": "Speech and Language Therapy",
    "TCE": "Chemical Engineering - likely TUM Chemical Engineering prefix",
}

PROGRAMME_YEARS = {
    "NUR": 2,
    "AAI": 3,
    "ACC": 3,
    "ASE": 3,
    "ATM": 3,
    "BAC": 3,
    "CDM": 3,
    "CEG": 3,
    "DSC": 3,
    "EPE": 3,
    "ESE": 3,
    "HTM": 3,
    "MDME": 3,
    "MEC": 3,
    "NAME": 3,
    "SBE": 3,
    "BICT": 4,
    "CVE": 4,
    "EDE": 4,
    "EEE": 4,
    "FDT": 4,
    "ICT": 4,
    "METS": 4,
    "RSE": 4,
    "RTY": 4,
    "SLT": 4,
    "TCE": 4,
}


def _get_or_create(db: DbSession, model, defaults: dict | None = None, **filters):
    instance = db.query(model).filter_by(**filters).first()
    if instance:
        return instance
    data = {**filters, **(defaults or {})}
    instance = model(**data)
    db.add(instance)
    db.flush()
    return instance


def seed_defaults(db: DbSession, raw_data_path: Path | None = DEFAULT_RAW_DATA_PATH) -> None:
    seed_reference_data(db, raw_data_path=raw_data_path)
    db.commit()


def seed_reference_data(db: DbSession, raw_data_path: Path | None = None) -> None:
    if raw_data_path and raw_data_path.exists():
        seed_raw_data_workbook(db, raw_data_path)
    _apply_programme_years(db)
    seed_time_slots(db)


def seed_time_slots(db: DbSession) -> None:
    for day in ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]:
        for week_pattern in ["Weekly", "Odd", "Even"]:
            for duration in [60, 120]:
                latest_start = 18 * 60 - duration
                for start in range(9 * 60, latest_start + 1, 60):
                    end = start + duration
                    _get_or_create(
                        db,
                        TimeSlot,
                        day=day,
                        start_time=minutes_to_time(start),
                        end_time=minutes_to_time(end),
                        week_pattern=week_pattern,
                        defaults={"duration_minutes": duration},
                    )


def seed_raw_data_workbook(db: DbSession, workbook_path: Path) -> None:
    """Seed supported reference tables from the raw-data workbook."""
    with pd.ExcelFile(workbook_path) as workbook:
        if "Campus Restrictions" in workbook.sheet_names and db.query(Room).count() == 0:
            _seed_rooms(db, _sort_frame(pd.read_excel(workbook, sheet_name="Campus Restrictions"), "Location Name"))
        if "Module Code" in workbook.sheet_names and db.query(Module).count() == 0:
            _seed_modules(db, _sort_frame(pd.read_excel(workbook, sheet_name="Module Code"), "Module Code"))
        if "Staff Information" in workbook.sheet_names and db.query(Staff).count() == 0:
            _seed_staff(db, _sort_frame(pd.read_excel(workbook, sheet_name="Staff Information"), "Name", "Host Key"))
        if "Common Modules" in workbook.sheet_names and db.query(Programme).count() == 0:
            _seed_programmes(db, pd.read_excel(workbook, sheet_name="Common Modules"))


def _sort_frame(frame: pd.DataFrame, *columns: str) -> pd.DataFrame:
    available = [column for column in columns if column in frame.columns]
    if not available:
        return frame
    return frame.sort_values(
        list(available),
        key=lambda series: series.astype(str).str.casefold(),
        na_position="last",
    )


def _seed_rooms(db: DbSession, frame: pd.DataFrame) -> None:
    for _, row in frame.dropna(how="all").iterrows():
        location_name = clean_text(row.get("Location Name"))
        if not location_name:
            continue
        resource_type = clean_text(row.get("Resource Type")) or "Room"
        room_address, room_code = _split_room_location(location_name)
        _get_or_create(
            db,
            Room,
            room_code=room_address,
            defaults={
                "room_name": room_code,
                "room_type": resource_type,
                "capacity": _int_or_default(row.get("Capacity"), 0),
                "is_virtual": "virtual" in resource_type.lower(),
                "campus_mode": "Virtual" if "virtual" in resource_type.lower() else "Physical",
                "recording_available": _yes_no(row.get("Recording")),
            },
        )


def _split_room_location(location_name: str) -> tuple[str, str]:
    match = re.match(r"^([A-Za-z0-9]+-[A-Za-z0-9]+-\d{2})-(.+)$", location_name.strip())
    if not match:
        return location_name, location_name
    return match.group(1), match.group(2).strip()


def _seed_modules(db: DbSession, frame: pd.DataFrame) -> None:
    for _, row in frame.dropna(how="all").iterrows():
        module_code = clean_text(row.get("Module Code"))
        if not module_code:
            continue
        _get_or_create(
            db,
            Module,
            module_code=module_code,
            defaults={
                "module_host_key": clean_text(row.get("Host Key")),
                "module_title": module_code,
                "term": clean_text(row.get("Term")),
            },
        )


def _seed_staff(db: DbSession, frame: pd.DataFrame) -> None:
    for _, row in frame.dropna(how="all").iterrows():
        staff_id = clean_text(row.get("Host Key"))
        staff_name = _clean_staff_name(row.get("Name"))
        if not staff_id or not staff_name:
            continue
        _get_or_create(
            db,
            Staff,
            staff_id=staff_id,
            defaults={"staff_name": staff_name, "staff_host_key": staff_id},
        )


def _seed_programmes(db: DbSession, frame: pd.DataFrame) -> None:
    codes = set()
    for _, row in frame.dropna(how="all").iterrows():
        codes.update(_programme_codes(row.get("Programmes")))
    for code in sorted(codes):
        programme = _get_or_create(
            db,
            Programme,
            code=code,
            defaults={"name": PROGRAMME_NAMES.get(code, code), "years": PROGRAMME_YEARS.get(code)},
        )
        canonical_name = PROGRAMME_NAMES.get(code)
        if canonical_name and programme.name != canonical_name:
            programme.name = canonical_name
        canonical_years = PROGRAMME_YEARS.get(code)
        if canonical_years and programme.years != canonical_years:
            programme.years = canonical_years


def _apply_programme_years(db: DbSession) -> None:
    for programme in db.query(Programme).all():
        canonical_years = PROGRAMME_YEARS.get(programme.code.upper())
        if canonical_years and programme.years != canonical_years:
            programme.years = canonical_years


def _programme_codes(value: object) -> set[str]:
    text = clean_text(value)
    if not text:
        return set()
    cleaned = re.sub(r"\([^)]*\)", "", text)
    cleaned = re.sub(r"\bAll programmes\b|\bexcept\b|\band\b", ",", cleaned, flags=re.IGNORECASE)
    parts = re.split(r"[,/&+]", cleaned)
    return {part.strip().upper() for part in parts if re.fullmatch(r"[A-Z][A-Z0-9]{1,9}", part.strip().upper())}


def _clean_staff_name(value: object) -> str | None:
    text = clean_text(value)
    if not text:
        return None
    return re.sub(r"\s+\.$", "", text).strip()


def _yes_no(value: object) -> bool:
    text = (clean_text(value) or "").lower()
    return text in {"yes", "y", "true", "1"}


def _int_or_default(value: object, default: int) -> int:
    text = clean_text(value)
    if text is None:
        return default
    try:
        return int(float(text))
    except ValueError:
        return default


def seed_sample_sessions(db: DbSession) -> None:
    _seed_demo_reference_data(db)
    dsc = db.query(Programme).filter_by(code="DSC").one()
    modules = {
        "DSC2204": _get_or_create(
            db,
            Module,
            module_code="DSC2204",
            defaults={"module_host_key": "DSC", "module_title": "Data Engineering", "term": "2510"},
        ),
        "INF1003": _get_or_create(
            db,
            Module,
            module_code="INF1003",
            defaults={"module_host_key": "INF", "module_title": "Programming Fundamentals", "term": "2510"},
        ),
        "UCS1001": _get_or_create(
            db,
            Module,
            module_code="UCS1001",
            defaults={"module_host_key": "UCS", "module_title": "Critical Thinking", "term": "2510"},
        ),
    }
    groups = {
        "DSC-Y2-G1": _get_or_create(
            db,
            StudentGroup,
            group_code="DSC-Y2-G1",
            defaults={"programme_id": dsc.id, "year": 2, "size": 80},
        ),
        "DSC-Y1-G1": _get_or_create(
            db,
            StudentGroup,
            group_code="DSC-Y1-G1",
            defaults={"programme_id": dsc.id, "year": 1, "size": 30},
        ),
    }
    staff = {
        "S001": _get_or_create(
            db,
            Staff,
            staff_id="S001",
            defaults={"staff_name": "Dr Tan", "staff_host_key": "DSC"},
        ),
        "S002": _get_or_create(
            db,
            Staff,
            staff_id="S002",
            defaults={"staff_name": "Prof Lim", "staff_host_key": "INF"},
        ),
        "S003": _get_or_create(
            db,
            Staff,
            staff_id="S003",
            defaults={"staff_name": "Ms Wong", "staff_host_key": "UCS"},
        ),
    }
    samples = [
        {
            "requirement_id": "REQ-DEMO-001",
            "module": modules["DSC2204"],
            "group": groups["DSC-Y2-G1"],
            "staff": staff["S001"],
            "class_type": "Lecture",
            "delivery_mode": "Face-to-face",
            "venue_type_required": "lectorial",
            "duration_minutes": 120,
            "exact_class_size": 80,
        },
        {
            "requirement_id": "REQ-DEMO-002",
            "module": modules["DSC2204"],
            "group": groups["DSC-Y2-G1"],
            "staff": staff["S001"],
            "class_type": "Tutorial",
            "delivery_mode": "Face-to-face",
            "venue_type_required": "classroom",
            "duration_minutes": 120,
            "exact_class_size": 40,
        },
        {
            "requirement_id": "REQ-DEMO-003",
            "module": modules["INF1003"],
            "group": groups["DSC-Y1-G1"],
            "staff": staff["S002"],
            "class_type": "Lab",
            "delivery_mode": "Face-to-face",
            "venue_type_required": "lab",
            "duration_minutes": 120,
            "exact_class_size": 30,
        },
        {
            "requirement_id": "REQ-DEMO-004",
            "module": modules["UCS1001"],
            "group": groups["DSC-Y1-G1"],
            "staff": staff["S003"],
            "class_type": "Online",
            "delivery_mode": "Online",
            "venue_type_required": "virtual",
            "duration_minutes": 120,
            "exact_class_size": 30,
        },
    ]
    for item in samples:
        db.add(
            Session(
                requirement_id=item["requirement_id"],
                programme_id=dsc.id,
                module_id=item["module"].id,
                student_group_id=item["group"].id,
                staff_id=item["staff"].id,
                class_type=item["class_type"],
                delivery_mode=item["delivery_mode"],
                campus_mode="Virtual" if item["delivery_mode"] == "Online" else "Physical",
                venue_type_required=item["venue_type_required"],
                duration_minutes=item["duration_minutes"],
                sessions_per_week=1,
                exact_class_size=item["exact_class_size"],
                start_week=1,
                end_week=13,
                week_pattern="Weekly",
                scheduling_type="Flexible",
                preferred_days="Monday,Tuesday",
                priority="Normal",
                source_file="seed",
                source_row_no=None,
            )
        )


def _seed_demo_reference_data(db: DbSession) -> None:
    programmes = [
        ("DSC", "Data Science", 3),
        ("ASE", "Applied Software Engineering", 3),
        ("MDME", "Mechanical Design and Manufacturing Engineering", 3),
    ]
    for code, name, years in sorted(programmes):
        _get_or_create(db, Programme, code=code, defaults={"name": name, "years": years})

    rooms = [
        ("VIRTUAL-ROOM-1", "Virtual Room 1", "virtual", 999, True, "Virtual", True),
        ("SR-01", "Seminar Room 01", "classroom", 40, False, "Physical", False),
        ("SR-02", "Seminar Room 02", "classroom", 60, False, "Physical", False),
        ("SR-03", "Seminar Room 03", "classroom", 80, False, "Physical", False),
        ("LAB-01", "Lab 01", "lab", 30, False, "Physical", False),
        ("LECT-01", "Lectorial 01", "lectorial", 120, False, "Physical", True),
    ]
    for code, name, room_type, capacity, is_virtual, campus_mode, recording in sorted(rooms):
        _get_or_create(
            db,
            Room,
            room_code=code,
            defaults={
                "room_name": name,
                "room_type": room_type,
                "capacity": capacity,
                "is_virtual": is_virtual,
                "campus_mode": campus_mode,
                "recording_available": recording,
            },
        )
