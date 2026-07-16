"""Quick-fix suggestions for generated timetable conflicts."""

from __future__ import annotations

import re

from app.models.constraint_violation import ConstraintViolation
from app.models.room import Room
from app.models.schedule_run import ScheduleRun
from app.models.scheduled_session import ScheduledSession
from app.models.student_group import StudentGroup
from app.models.time_slot import TimeSlot
from app.services.compatibility import (
    DAY_ORDER,
    intervals_overlap,
    normalize_token,
    parse_day_list,
    session_weeks_conflict,
    time_to_minutes,
)
from app.services.scheduling_rules import candidate_room_allowed, required_student_group_codes
from sqlalchemy.orm import Session as DbSession


class QuickFixService:
    def availability(self, db: DbSession, schedule_run_id: int) -> dict:
        run = db.query(ScheduleRun).filter_by(id=schedule_run_id).first()
        if run is None:
            raise ValueError("Schedule run not found.")

        scheduled = (
            db.query(ScheduledSession)
            .filter(
                ScheduledSession.schedule_run_id == schedule_run_id,
                ScheduledSession.included_in_final.is_(True),
            )
            .order_by(ScheduledSession.day, ScheduledSession.start_time)
            .all()
        )
        violations = db.query(ConstraintViolation).filter_by(schedule_run_id=schedule_run_id).all()
        affected_session_ids = {
            int(value.strip()) for violation in violations for value in (violation.affected_session_ids or "").split(",") if value.strip()
        }
        targets = {item.session_id: item for item in scheduled if item.session_id in affected_session_ids}
        rooms = db.query(Room).order_by(Room.room_code).all()
        groups = db.query(StudentGroup).order_by(StudentGroup.group_code).all()
        slots = db.query(TimeSlot).order_by(TimeSlot.day, TimeSlot.start_time).all()
        group_ids_by_code = {group.group_code.lower(): group.id for group in groups}

        by_session_id = {
            str(session_id): self._has_clean_suggestion(
                target,
                scheduled,
                rooms,
                slots,
                group_ids_by_code,
            )
            for session_id, target in targets.items()
        }
        for session_id in affected_session_ids:
            by_session_id.setdefault(str(session_id), False)

        by_conflict_id = {}
        for violation in violations:
            target_session_id = self._first_affected_session_id(violation)
            by_conflict_id[str(violation.id)] = bool(target_session_id is not None and by_session_id.get(str(target_session_id), False))

        return {
            "schedule_run_id": schedule_run_id,
            "by_session_id": by_session_id,
            "by_conflict_id": by_conflict_id,
        }

    def suggest_fixes(
        self,
        db: DbSession,
        schedule_run_id: int,
        conflict_id: int | None = None,
        session_id: int | None = None,
    ) -> dict:
        violation = self._violation(db, schedule_run_id, conflict_id) if conflict_id is not None else None
        target_session_id = session_id or self._first_affected_session_id(violation)
        if target_session_id is None:
            raise ValueError("A conflict ID or session ID is required.")

        scheduled = (
            db.query(ScheduledSession)
            .filter(
                ScheduledSession.schedule_run_id == schedule_run_id,
                ScheduledSession.included_in_final.is_(True),
            )
            .order_by(ScheduledSession.day, ScheduledSession.start_time)
            .all()
        )
        target = next((item for item in scheduled if item.session_id == target_session_id), None)
        if target is None:
            raise ValueError("Scheduled session not found for this run.")

        rooms = db.query(Room).order_by(Room.room_code).all()
        groups = db.query(StudentGroup).order_by(StudentGroup.group_code).all()
        slots = db.query(TimeSlot).order_by(TimeSlot.day, TimeSlot.start_time).all()
        suggestions = self._ranked_suggestions(target, scheduled, rooms, groups, slots)
        severity = violation.severity if violation is not None else self._target_severity(db, schedule_run_id, target.session_id)

        return {
            "conflict_id": conflict_id,
            "severity": severity,
            "session_id": target.session_id,
            "suggestions": suggestions[:3],
        }

    def _ranked_suggestions(
        self,
        target: ScheduledSession,
        scheduled: list[ScheduledSession],
        rooms: list[Room],
        groups: list[StudentGroup],
        slots: list[TimeSlot],
    ) -> list[dict]:
        if target.session and target.session.is_lab_requirement:
            return []
        group_ids_by_code = {group.group_code.lower(): group.id for group in groups}
        candidates = []
        for room in rooms:
            if not candidate_room_allowed(target.session, room):
                continue
            for slot in slots:
                if not self._slot_allowed(target, slot):
                    continue
                if self._same_placement(target, room, slot):
                    continue
                if not self._placement_is_clean(target, room, slot, scheduled, group_ids_by_code):
                    continue
                suggestion_type = self._suggestion_type(target, room, slot)
                candidates.append((suggestion_type, self._score(target, room, slot, suggestion_type), room, slot))

        selected = []
        used = set()
        for suggestion_type in ["VENUE_CHANGE", "TIME_CHANGE", "ALTERNATIVE_BEST"]:
            match = min(
                (item for item in candidates if item[0] == suggestion_type),
                key=lambda item: item[1],
                default=None,
            )
            if match is None:
                continue
            selected.append(match)
            used.add((match[2].id, match[3].id))

        if len(selected) < 3:
            for item in sorted(candidates, key=lambda item: item[1]):
                key = (item[2].id, item[3].id)
                if key in used:
                    continue
                selected.append(item)
                used.add(key)
                if len(selected) == 3:
                    break

        return [self._serialize_suggestion(target, suggestion_type, room, slot) for suggestion_type, _, room, slot in selected]

    def _has_clean_suggestion(
        self,
        target: ScheduledSession,
        scheduled: list[ScheduledSession],
        rooms: list[Room],
        slots: list[TimeSlot],
        group_ids_by_code: dict[str, int],
    ) -> bool:
        if target.session and target.session.is_lab_requirement:
            return False
        for room in rooms:
            if not candidate_room_allowed(target.session, room):
                continue
            for slot in slots:
                if not self._slot_allowed(target, slot) or self._same_placement(target, room, slot):
                    continue
                if self._placement_is_clean(target, room, slot, scheduled, group_ids_by_code):
                    return True
        return False

    def _violation(self, db: DbSession, schedule_run_id: int, conflict_id: int) -> ConstraintViolation:
        violation = db.query(ConstraintViolation).filter_by(id=conflict_id, schedule_run_id=schedule_run_id).first()
        if violation is None:
            raise ValueError("Conflict not found for this schedule run.")
        return violation

    def _first_affected_session_id(self, violation: ConstraintViolation | None) -> int | None:
        if violation is None or not violation.affected_session_ids:
            return None
        for value in violation.affected_session_ids.split(","):
            value = value.strip()
            if value:
                return int(value)
        return None

    def _target_severity(self, db: DbSession, schedule_run_id: int, session_id: int) -> str:
        severities = []
        for violation in db.query(ConstraintViolation).filter_by(schedule_run_id=schedule_run_id).all():
            affected = {int(value.strip()) for value in (violation.affected_session_ids or "").split(",") if value.strip()}
            if session_id in affected:
                severities.append(violation.severity)
        if "HARD" in severities:
            return "HARD"
        if "SOFT" in severities:
            return "SOFT"
        return "HARD"

    def _slot_allowed(self, target: ScheduledSession, slot: TimeSlot) -> bool:
        session = target.session
        if slot.week_pattern != target.week_pattern:
            return False
        if target.start_time and target.end_time:
            duration = (time_to_minutes(target.end_time) or 0) - (time_to_minutes(target.start_time) or 0)
            if slot.duration_minutes != duration:
                return False
        if normalize_token(session.priority) == "hard" and slot.day in parse_day_list(session.avoid_days):
            return False
        return True

    def _placement_is_clean(
        self,
        target: ScheduledSession,
        room: Room,
        slot: TimeSlot,
        scheduled: list[ScheduledSession],
        group_ids_by_code: dict[str, int],
    ) -> bool:
        target_staff_ids = set(self._session_staff_ids(target))
        target_group_ids = set(self._scheduled_group_ids(target, group_ids_by_code))
        target_room_ids = {room.id}
        for item in scheduled:
            if item.id == target.id:
                continue
            if not self._overlaps(item, slot, target.session):
                continue
            if target_room_ids.intersection(self._scheduled_room_ids(item)):
                return False
            if target_group_ids.intersection(self._scheduled_group_ids(item, group_ids_by_code)):
                return False
            if target_staff_ids.intersection(self._session_staff_ids(item)):
                return False
        return True

    def _overlaps(self, item: ScheduledSession, slot: TimeSlot, target_session) -> bool:
        return (
            item.day == slot.day
            and session_weeks_conflict(item.session, item.time_slot, target_session, slot)
            and intervals_overlap(item.start_time, item.end_time, slot.start_time, slot.end_time)
        )

    def _same_placement(self, target: ScheduledSession, room: Room, slot: TimeSlot) -> bool:
        return (
            target.room_id == room.id
            and target.day == slot.day
            and target.start_time == slot.start_time
            and target.end_time == slot.end_time
            and target.week_pattern == slot.week_pattern
        )

    def _suggestion_type(self, target: ScheduledSession, room: Room, slot: TimeSlot) -> str:
        if target.day == slot.day and target.start_time == slot.start_time and target.end_time == slot.end_time:
            return "VENUE_CHANGE"
        if target.room_id == room.id:
            return "TIME_CHANGE"
        return "ALTERNATIVE_BEST"

    def _score(self, target: ScheduledSession, room: Room, slot: TimeSlot, suggestion_type: str) -> int:
        type_score = {"VENUE_CHANGE": 0, "TIME_CHANGE": 100_000, "ALTERNATIVE_BEST": 200_000}[suggestion_type]
        return (
            type_score
            + self._day_distance(target.day, slot.day) * 1_000
            + self._time_distance(target, slot)
            + self._room_distance(target.room.room_code, room.room_code)
        )

    def _day_distance(self, current_day: str, candidate_day: str) -> int:
        try:
            current_index = DAY_ORDER.index(current_day)
            candidate_index = DAY_ORDER.index(candidate_day)
        except ValueError:
            return 99
        return abs(candidate_index - current_index)

    def _time_distance(self, target: ScheduledSession, slot: TimeSlot) -> int:
        return abs((time_to_minutes(slot.start_time) or 0) - (time_to_minutes(target.start_time) or 0))

    def _room_distance(self, current_code: str, candidate_code: str) -> int:
        if current_code == candidate_code:
            return 0
        current_prefix, current_number = self._room_parts(current_code)
        candidate_prefix, candidate_number = self._room_parts(candidate_code)
        prefix_penalty = 0 if current_prefix and current_prefix == candidate_prefix else 500
        if current_number is None or candidate_number is None:
            return prefix_penalty + 100
        return prefix_penalty + abs(candidate_number - current_number)

    def _room_parts(self, room_code: str) -> tuple[str, int | None]:
        match = re.match(r"^(.*?)(\d+)$", room_code)
        if not match:
            return room_code, None
        return match.group(1), int(match.group(2))

    def _session_staff_ids(self, item: ScheduledSession) -> list[int]:
        ids = [
            assignment.staff_id for assignment in getattr(item.session, "staff_assignments", []) or [] if assignment.staff_id is not None
        ]
        if not ids and item.staff_id is not None:
            ids.append(item.staff_id)
        return ids

    def _scheduled_room_ids(self, item: ScheduledSession) -> list[int]:
        return [item.room_id] if item.room_id is not None else []

    def _scheduled_group_ids(self, item: ScheduledSession, group_ids_by_code: dict[str, int]) -> list[int]:
        ids = [item.session.student_group_id] if item.session and item.session.student_group_id is not None else []
        if item.session:
            for code in required_student_group_codes(item.session):
                group_id = group_ids_by_code.get(code.lower())
                if group_id is not None:
                    ids.append(group_id)
        return list(dict.fromkeys(ids))

    def _serialize_suggestion(self, target: ScheduledSession, suggestion_type: str, room: Room, slot: TimeSlot) -> dict:
        description = self._description(target, suggestion_type, room, slot)
        return {
            "type": suggestion_type,
            "description": description,
            "session_id": target.session_id,
            "new_room": room.room_code,
            "new_time": f"{slot.day} {slot.start_time}-{slot.end_time}",
            "room_code": room.room_code,
            "day": slot.day,
            "start_time": slot.start_time,
            "end_time": slot.end_time,
        }

    def _description(self, target: ScheduledSession, suggestion_type: str, room: Room, slot: TimeSlot) -> str:
        if suggestion_type == "VENUE_CHANGE":
            return f"Move to Room {room.room_code} (Keep {slot.day} {slot.start_time}-{slot.end_time})"
        if suggestion_type == "TIME_CHANGE":
            return f"Shift to {slot.day} {slot.start_time}-{slot.end_time} (Keep Room {room.room_code})"
        return f"Move to Room {room.room_code} on {slot.day} {slot.start_time}-{slot.end_time}"
