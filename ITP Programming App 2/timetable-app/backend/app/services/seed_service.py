"""Startup seed data for empty split databases.

Reference data can be populated from the real multi-sheet raw-data workbook.
The scheduler still needs a generated time-slot grid and default programme-year
student groups, but demo rooms, staff, modules, programmes, and sessions are
intentionally not seeded.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd
from app.models.lab_requirement import LabRequirement
from app.models.module import Module
from app.models.programme import Programme
from app.models.room import Room
from app.models.session import Session
from app.models.staff import Staff
from app.models.student_group import StudentGroup
from app.models.time_slot import TimeSlot
from app.services.compatibility import clean_text, minutes_to_time, time_to_minutes
from app.services.scheduling_constants import SCHEDULING_DAY_END_TIME, SCHEDULING_DAY_START_TIME
from app.services.student_group_service import (
    ensure_programme_year_groups,
    normalize_student_group_ids,
    student_group_code,
)
from sqlalchemy import func
from sqlalchemy.orm import Session as DbSession

DEFAULT_RAW_DATA_PATH = Path(__file__).resolve().parents[2] / "data" / "Raw Data.xlsx"
DEFAULT_LAB_REQUIREMENTS_PATH = Path(__file__).resolve().parents[1] / "data" / "lab_requirements_seed.json"

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


def seed_defaults(
    db: DbSession,
    raw_data_path: Path | None = DEFAULT_RAW_DATA_PATH,
    seed_lab_requirements: bool = True,
) -> None:
    seed_reference_data(db, raw_data_path=raw_data_path)
    if seed_lab_requirements:
        seed_lab_reference_data(db, DEFAULT_LAB_REQUIREMENTS_PATH)
    db.commit()


def seed_reference_data(db: DbSession, raw_data_path: Path | None = None) -> None:
    from app.services.academic_calendar_service import AcademicCalendarService

    if raw_data_path and raw_data_path.exists():
        seed_raw_data_workbook(db, raw_data_path)
    _apply_programme_years(db)
    ensure_programme_year_groups(db)
    normalize_student_group_ids(db)
    seed_time_slots(db)
    AcademicCalendarService().seed(db)


def seed_time_slots(db: DbSession) -> None:
    day_start = time_to_minutes(SCHEDULING_DAY_START_TIME)
    day_end = time_to_minutes(SCHEDULING_DAY_END_TIME)
    for day in ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]:
        for week_pattern in ["Weekly", "Odd", "Even"]:
            for duration in [60, 90, 120, 150, 180, 240, 300]:
                latest_start = day_end - duration
                step = 30 if duration in {90, 150} else 60
                for start in range(day_start, latest_start + 1, step):
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


def seed_lab_reference_data(db: DbSession, seed_path: Path | None = DEFAULT_LAB_REQUIREMENTS_PATH) -> None:
    """Seed built-in lab source rows and reference records without overwriting admin edits."""

    if not seed_path or not seed_path.exists():
        return
    data = json.loads(seed_path.read_text(encoding="ascii"))
    for item in data.get("rooms", []):
        room = _get_or_create(
            db,
            Room,
            room_code=clean_text(item.get("room_code")),
            defaults={
                "room_name": clean_text(item.get("room_name")) or clean_text(item.get("room_code")),
                "room_type": clean_text(item.get("room_type")) or "Lab",
                "capacity": _int_or_default(item.get("capacity"), 1),
                "is_virtual": bool(item.get("is_virtual")),
                "campus_mode": clean_text(item.get("campus_mode")) or ("Virtual" if item.get("is_virtual") else "Physical"),
                "recording_available": bool(item.get("recording_available")),
            },
        )
        if not room.room_name:
            room.room_name = clean_text(item.get("room_name")) or room.room_code
        if not room.room_type:
            room.room_type = clean_text(item.get("room_type")) or "Lab"
        if not room.capacity or room.capacity <= 0:
            room.capacity = _int_or_default(item.get("capacity"), 1)
    for item in data.get("modules", []):
        module_code = clean_text(item.get("module_code"))
        if not module_code:
            continue
        _get_or_create(
            db,
            Module,
            module_code=module_code,
            defaults={
                "module_title": clean_text(item.get("module_title")) or module_code,
                "term": clean_text(item.get("term")),
            },
        )
    for item in data.get("missing_staff", []):
        staff_name = _clean_staff_name(item.get("staff_name"))
        if not staff_name:
            continue
        existing = db.query(Staff).filter(func.lower(Staff.staff_name) == staff_name.lower()).first()
        if not existing:
            db.add(Staff(staff_name=staff_name, staff_id=clean_text(item.get("staff_id"))))
            db.flush()
    if db.query(LabRequirement).count() > 0:
        return
    for item in data.get("lab_requirements", []):
        db.add(
            LabRequirement(
                requirement_id=clean_text(item.get("requirement_id")),
                is_active=bool(item.get("is_active")),
                source_sheet=clean_text(item.get("source_sheet")),
                source_row_no=_int_or_default(item.get("source_row_no"), 0),
                programme=clean_text(item.get("programme")),
                raw_programme=clean_text(item.get("raw_programme")),
                year=_int_or_default(item.get("year"), 0) or None,
                module_code=clean_text(item.get("module_code")),
                student_group=clean_text(item.get("student_group")),
                student_group_codes=clean_text(item.get("student_group_codes")),
                group_size=_int_or_default(item.get("group_size"), 0) or None,
                fixed_day=clean_text(item.get("fixed_day")),
                fixed_start_time=clean_text(item.get("fixed_start_time")),
                fixed_end_time=clean_text(item.get("fixed_end_time")),
                duration_minutes=_int_or_default(item.get("duration_minutes"), 0) or None,
                week_pattern=clean_text(item.get("week_pattern")),
                custom_weeks=clean_text(item.get("custom_weeks")),
                location=clean_text(item.get("location")),
                required_room_codes=clean_text(item.get("required_room_codes")),
                staff_names=clean_text(item.get("staff_names")),
                class_type=clean_text(item.get("class_type")),
                delivery_mode=clean_text(item.get("delivery_mode")),
                campus_mode=clean_text(item.get("campus_mode")),
                venue_type_required=clean_text(item.get("venue_type_required")),
                start_at_7pm=bool(item.get("start_at_7pm")),
                setup_turnaround_note=clean_text(item.get("setup_turnaround_note")),
                notes=clean_text(item.get("notes")),
            )
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
            defaults={"staff_name": staff_name},
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
    ensure_programme_year_groups(db)
    normalize_student_group_ids(db)
    dsc = db.query(Programme).filter_by(code="DSC").one()
    modules = {
        "DSC2204": _get_or_create(
            db,
            Module,
            module_code="DSC2204",
            defaults={"module_title": "Data Engineering", "term": "2510"},
        ),
        "INF1003": _get_or_create(
            db,
            Module,
            module_code="INF1003",
            defaults={"module_title": "Programming Fundamentals", "term": "2510"},
        ),
        "UCS1001": _get_or_create(
            db,
            Module,
            module_code="UCS1001",
            defaults={"module_title": "Critical Thinking", "term": "2510"},
        ),
    }
    groups = {
        "DSC Y2 P1": db.query(StudentGroup).filter_by(group_code=student_group_code("DSC", 2, 1)).one(),
        "DSC Y1 P1": db.query(StudentGroup).filter_by(group_code=student_group_code("DSC", 1, 1)).one(),
    }
    staff = {
        "S001": _get_or_create(
            db,
            Staff,
            staff_id="S001",
            defaults={"staff_name": "Dr Tan"},
        ),
        "S002": _get_or_create(
            db,
            Staff,
            staff_id="S002",
            defaults={"staff_name": "Prof Lim"},
        ),
        "S003": _get_or_create(
            db,
            Staff,
            staff_id="S003",
            defaults={"staff_name": "Ms Wong"},
        ),
    }
    samples = [
        {
            "requirement_id": "REQ-DEMO-001",
            "module": modules["DSC2204"],
            "group": groups["DSC Y2 P1"],
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
            "group": groups["DSC Y2 P1"],
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
            "group": groups["DSC Y1 P1"],
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
            "group": groups["DSC Y1 P1"],
            "staff": staff["S003"],
            "class_type": "Lecture",
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
