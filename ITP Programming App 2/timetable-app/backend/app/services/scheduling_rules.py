"""Shared timetable compatibility rules.

The validator and CP-SAT model builder both need to answer the same core
questions: can this requirement use this slot, can it use this room, and do two
fixed requirements clash?  Keeping those rules here prevents the two workflows
from drifting apart.
"""

from __future__ import annotations

from app.models.room import Room
from app.models.session import Session
from app.models.time_slot import TimeSlot
from app.services.compatibility import (
    delivery_room_compatible,
    intervals_overlap,
    normalize_token,
    parse_custom_weeks,
    parse_day_list,
    room_capacity_fits,
    time_to_minutes,
    venue_room_compatible,
    weeks_conflict,
)


def candidate_slot_allowed(session: Session, slot: TimeSlot) -> bool:
    """Return whether a saved requirement can be assigned to a time slot."""

    if session.duration_minutes and slot.duration_minutes != session.duration_minutes:
        return False

    start_min = time_to_minutes(slot.start_time) or 0
    end_min = time_to_minutes(slot.end_time) or 0

    if slot.day == "Wednesday" and end_min > 780:
        return False
    if slot.day == "Friday" and start_min < 840 and end_min > 720:
        return False
    if start_min < 780 and end_min > 720:
        return False
    if slot.day == "Friday" and end_min > 1020:
        return False

    session_week = normalize_token(session.week_pattern or "Weekly")
    slot_week = normalize_token(slot.week_pattern)
    if session_week == "custom":
        custom_weeks = parse_custom_weeks(session.custom_weeks)
        if custom_weeks:
            has_odd = any(week % 2 == 1 for week in custom_weeks)
            has_even = any(week % 2 == 0 for week in custom_weeks)
            if has_odd and not has_even and slot_week != "odd":
                return False
            if has_even and not has_odd and slot_week != "even":
                return False
            if has_odd and has_even and slot_week != "weekly":
                return False
    elif session_week in {"weekly", "odd", "even"} and session_week != slot_week:
        return False

    if normalize_token(session.scheduling_type) == "fixed":
        if session.fixed_day and slot.day != session.fixed_day:
            return False
        if session.fixed_start_time and slot.start_time != session.fixed_start_time:
            return False
        if session.fixed_end_time and slot.end_time != session.fixed_end_time:
            return False

    if normalize_token(session.priority) == "hard" and slot.day in parse_day_list(session.avoid_days):
        return False

    return True


def candidate_room_allowed(session: Session, room: Room) -> bool:
    """Return whether a saved requirement can be assigned to a room."""

    return (
        room_capacity_fits(session, room)
        and delivery_room_compatible(session, room)
        and venue_room_compatible(session, room)
    )


def fixed_sessions_conflict(left: Session, right: Session) -> bool:
    """Return whether two fixed requirements overlap in time and week pattern."""

    return (
        left.fixed_day == right.fixed_day
        and weeks_conflict(left.week_pattern, right.week_pattern)
        and intervals_overlap(
            left.fixed_start_time or "",
            left.fixed_end_time or "",
            right.fixed_start_time or "",
            right.fixed_end_time or "",
        )
    )


def session_label(session: Session) -> str:
    if session.requirement_id:
        return session.requirement_id
    if session.module:
        return session.module.module_code
    return f"session {session.id}"


def staff_label(session: Session) -> str:
    if session.staff:
        return session.staff.staff_name or session.staff.staff_id
    return str(session.staff_id)


def student_group_label(session: Session) -> str:
    if session.student_group:
        return session.student_group.group_code
    return str(session.student_group_id)
