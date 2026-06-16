"""Serializer helpers that convert SQLAlchemy models into API dictionaries."""

from __future__ import annotations

from app.models.constraint_violation import ConstraintViolation
from app.models.module import Module
from app.models.programme import Programme
from app.models.room import Room
from app.models.schedule_run import ScheduleRun
from app.models.session import Session
from app.models.staff import Staff
from app.models.student_group import StudentGroup
from app.models.time_slot import TimeSlot


def programme_to_dict(item: Programme) -> dict:
    return {"id": item.id, "code": item.code, "name": item.name, "cluster": item.cluster}


def module_to_dict(item: Module) -> dict:
    return {
        "id": item.id,
        "module_code": item.module_code,
        "module_host_key": item.module_host_key,
        "module_title": item.module_title,
        "term": item.term,
    }


def group_to_dict(item: StudentGroup) -> dict:
    return {
        "id": item.id,
        "group_code": item.group_code,
        "programme_id": item.programme_id,
        "programme": item.programme.code if item.programme else None,
        "year": item.year,
        "size": item.size,
    }


def staff_to_dict(item: Staff) -> dict:
    return {
        "id": item.id,
        "staff_name": item.staff_name,
        "staff_id": item.staff_id,
        "staff_host_key": item.staff_host_key,
    }


def session_staff_items(item: Session) -> list[dict]:
    assignments = list(getattr(item, "staff_assignments", []) or [])
    if not assignments and item.staff:
        return [{"staff_id": item.staff.staff_id, "staff_name": item.staff.staff_name, "is_primary": True, "staff_order": 1}]
    return [
        {
            "staff_id": assignment.staff.staff_id if assignment.staff else None,
            "staff_name": assignment.staff.staff_name if assignment.staff else None,
            "is_primary": assignment.is_primary,
            "staff_order": assignment.staff_order,
        }
        for assignment in assignments
    ]


def session_staff_names(item: Session) -> str | None:
    names = [staff["staff_name"] or staff["staff_id"] for staff in session_staff_items(item) if staff["staff_name"] or staff["staff_id"]]
    return ", ".join(names) if names else None


def session_staff_ids(item: Session) -> str | None:
    ids = [staff["staff_id"] for staff in session_staff_items(item) if staff["staff_id"]]
    return ", ".join(ids) if ids else None


def room_to_dict(item: Room) -> dict:
    return {
        "id": item.id,
        "room_code": item.room_code,
        "room_name": item.room_name,
        "room_type": item.room_type,
        "capacity": item.capacity,
        "is_virtual": item.is_virtual,
        "campus_mode": item.campus_mode,
        "recording_available": item.recording_available,
    }


def time_slot_to_dict(item: TimeSlot) -> dict:
    return {
        "id": item.id,
        "day": item.day,
        "start_time": item.start_time,
        "end_time": item.end_time,
        "duration_minutes": item.duration_minutes,
        "week_pattern": item.week_pattern,
    }


def session_to_dict(item: Session) -> dict:
    return {
        "id": item.id,
        "requirement_id": item.requirement_id,
        "programme": item.programme.code if item.programme else None,
        "module_code": item.module.module_code if item.module else None,
        "student_group_code": item.student_group.group_code if item.student_group else None,
        "staff_name": item.staff.staff_name if item.staff else None,
        "staff_id": item.staff.staff_id if item.staff else None,
        "co_teachers": session_staff_items(item),
        "co_teacher_names": session_staff_names(item),
        "co_teacher_ids": session_staff_ids(item),
        "class_type": item.class_type,
        "delivery_mode": item.delivery_mode,
        "campus_mode": item.campus_mode,
        "venue_type_required": item.venue_type_required,
        "duration_minutes": item.duration_minutes,
        "sessions_per_week": item.sessions_per_week,
        "exact_class_size": item.exact_class_size,
        "start_week": item.start_week,
        "end_week": item.end_week,
        "week_pattern": item.week_pattern,
        "custom_weeks": item.custom_weeks,
        "scheduling_type": item.scheduling_type,
        "fixed_day": item.fixed_day,
        "fixed_start_time": item.fixed_start_time,
        "fixed_end_time": item.fixed_end_time,
        "preferred_days": item.preferred_days,
        "avoid_days": item.avoid_days,
        "priority": item.priority,
        "remarks": item.remarks,
        "source_file": item.source_file,
        "source_row_no": item.source_row_no,
    }


def schedule_run_to_dict(item: ScheduleRun) -> dict:
    return {
        "id": item.id,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "status": item.status,
        "solver_status": item.solver_status,
        "hard_violation_count": item.hard_violation_count,
        "soft_score": item.soft_score,
        "message": item.message,
    }


def violation_to_dict(item: ConstraintViolation) -> dict:
    affected = []
    if item.affected_session_ids:
        affected = [int(value) for value in item.affected_session_ids.split(",") if value]
    return {
        "id": item.id,
        "schedule_run_id": item.schedule_run_id,
        "constraint_code": item.constraint_code,
        "severity": item.severity,
        "message": item.message,
        "affected_session_ids": affected,
    }
