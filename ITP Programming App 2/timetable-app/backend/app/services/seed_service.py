from __future__ import annotations

from sqlalchemy.orm import Session as DbSession

from app.models.module import Module
from app.models.programme import Programme
from app.models.room import Room
from app.models.session import Session
from app.models.staff import Staff
from app.models.student_group import StudentGroup
from app.models.time_slot import TimeSlot
from app.services.compatibility import minutes_to_time


def _get_or_create(db: DbSession, model, defaults: dict | None = None, **filters):
    instance = db.query(model).filter_by(**filters).first()
    if instance:
        return instance
    data = {**filters, **(defaults or {})}
    instance = model(**data)
    db.add(instance)
    db.flush()
    return instance


def seed_defaults(db: DbSession) -> None:
    seed_reference_data(db)
    if db.query(Session).count() == 0:
        seed_sample_sessions(db)
    db.commit()


def seed_reference_data(db: DbSession) -> None:
    programmes = [
        ("DSC", "Data Science", "Computing"),
        ("ASE", "Applied Software Engineering", "Engineering"),
        ("MDME", "Mechanical Design and Manufacturing Engineering", "Engineering"),
    ]
    for code, name, cluster in programmes:
        _get_or_create(db, Programme, code=code, defaults={"name": name, "cluster": cluster})

    rooms = [
        ("VIRTUAL-ROOM-1", "Virtual Room 1", "virtual", 999, True, "Virtual", True),
        ("SR-01", "Seminar Room 01", "classroom", 40, False, "Physical", False),
        ("SR-02", "Seminar Room 02", "classroom", 60, False, "Physical", False),
        ("SR-03", "Seminar Room 03", "classroom", 80, False, "Physical", False),
        ("LAB-01", "Lab 01", "lab", 30, False, "Physical", False),
        ("LECT-01", "Lectorial 01", "lectorial", 120, False, "Physical", True),
    ]
    for code, name, room_type, capacity, is_virtual, campus_mode, recording in rooms:
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


def seed_sample_sessions(db: DbSession) -> None:
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
