"""Guided resolution suggestions for generated schedule conflicts."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session as DbSession

from app.models.constraint_violation import ConstraintViolation
from app.models.room import Room
from app.models.scheduled_session import ScheduledSession
from app.models.time_slot import TimeSlot
from app.services.compatibility import (
    intervals_overlap,
    is_online_mode,
    normalize_token,
    parse_day_list,
    time_to_minutes,
    weeks_conflict,
)
from app.services.constraint_service import ConstraintService
from app.services.scheduling_rules import candidate_room_allowed, candidate_slot_allowed
from app.services.soft_constraint_priority_service import SoftConstraintPriorityService

DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
SUPPORTED_RULES = {"CLASS_AFTER_1700"}


@dataclass(frozen=True)
class ResolutionCandidate:
    score: int
    session_id: int
    day: str
    start_time: str
    end_time: str
    week_pattern: str
    room_code: str
    room_name: str | None
    summary: str
    reason: str
    resolves: list[str]
    tradeoffs: list[str]
    requires_fixed_update: bool

    def to_dict(self) -> dict:
        return {
            "score": self.score,
            "session_id": self.session_id,
            "day": self.day,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "week_pattern": self.week_pattern,
            "room_code": self.room_code,
            "room_name": self.room_name,
            "summary": self.summary,
            "reason": self.reason,
            "resolves": self.resolves,
            "tradeoffs": self.tradeoffs,
            "requires_fixed_update": self.requires_fixed_update,
        }


class ResolutionService:
    def suggestions_for_violation(
        self,
        db: DbSession,
        schedule_run_id: int,
        violation_id: int,
        limit: int = 3,
    ) -> list[dict]:
        violation = (
            db.query(ConstraintViolation)
            .filter_by(id=violation_id, schedule_run_id=schedule_run_id)
            .first()
        )
        if not violation:
            return []
        if violation.constraint_code not in SUPPORTED_RULES:
            return []
        session_ids = self._affected_session_ids(violation)
        if len(session_ids) != 1:
            return []
        scheduled = (
            db.query(ScheduledSession)
            .filter_by(schedule_run_id=schedule_run_id, session_id=session_ids[0])
            .first()
        )
        if not scheduled:
            return []

        constraint_service = ConstraintService()
        active_rules = constraint_service.active_rules(db)
        soft_weights = SoftConstraintPriorityService().weights(db)
        scheduled_items = db.query(ScheduledSession).filter_by(schedule_run_id=schedule_run_id).all()
        rooms = db.query(Room).order_by(Room.room_code).all()
        slots = db.query(TimeSlot).order_by(TimeSlot.day, TimeSlot.start_time, TimeSlot.week_pattern).all()
        candidates: list[ResolutionCandidate] = []
        ignore_fixed = normalize_token(scheduled.session.scheduling_type) == "fixed"

        for slot in slots:
            if not candidate_slot_allowed(scheduled.session, slot, ignore_fixed=ignore_fixed):
                continue
            for room in rooms:
                if not candidate_room_allowed(scheduled.session, room):
                    continue
                if self._same_assignment(scheduled, slot, room):
                    continue
                if self._hard_conflicts(scheduled, slot, room, scheduled_items):
                    continue
                assignment = {"session": scheduled.session, "time_slot": slot, "room": room}
                if violation.constraint_code in constraint_service.rule_validator.assignment_penalty_codes(assignment, active_rules):
                    continue
                candidates.append(
                    self._candidate_from_slot(
                        scheduled,
                        slot,
                        room,
                        violation.constraint_code,
                        soft_weights,
                        ignore_fixed,
                    )
                )

        return [
            item.to_dict()
            for item in sorted(candidates, key=lambda item: (-item.score, self._day_index(item.day), item.start_time))[:limit]
        ]

    def _candidate_from_slot(
        self,
        scheduled: ScheduledSession,
        slot: TimeSlot,
        room: Room,
        code: str,
        soft_weights: dict[str, int],
        requires_fixed_update: bool,
    ) -> ResolutionCandidate:
        score = 100
        tradeoffs: list[str] = []
        preferred = parse_day_list(scheduled.session.preferred_days)
        avoid = parse_day_list(scheduled.session.avoid_days)
        if preferred and slot.day not in preferred:
            score -= soft_weights.get("PREFERRED_DAY_MISMATCH", 15)
            tradeoffs.append("Misses the preferred day.")
        if avoid and slot.day in avoid:
            score -= soft_weights.get("AVOID_DAY", 30)
            tradeoffs.append("Uses an avoided day.")
        if is_online_mode(scheduled.session.delivery_mode) and slot.day not in {"Monday", "Tuesday"}:
            score -= soft_weights.get("ONLINE_NOT_MON_TUE", 5)
            tradeoffs.append("Online session is outside Monday/Tuesday.")
        class_size = scheduled.session.exact_class_size or 0
        if not room.is_virtual and room.capacity > 0 and class_size and class_size / room.capacity < 0.6:
            score -= soft_weights.get("LOW_ROOM_UTILISATION", 10)
            tradeoffs.append("Room utilization is below 60%.")
        if requires_fixed_update:
            tradeoffs.append("Updates the fixed day/time on the requirement.")
        start_min = time_to_minutes(slot.start_time) or 0
        score -= max(0, start_min - 9 * 60) // 240
        score = max(1, score)
        return ResolutionCandidate(
            score=score,
            session_id=scheduled.session_id,
            day=slot.day,
            start_time=slot.start_time,
            end_time=slot.end_time,
            week_pattern=slot.week_pattern,
            room_code=room.room_code,
            room_name=room.room_name,
            summary=f"Move to {slot.day} {slot.start_time}-{slot.end_time}",
            reason=f"Resolves {code}; room, staff, and student group are available.",
            resolves=[code],
            tradeoffs=tradeoffs,
            requires_fixed_update=requires_fixed_update,
        )

    def _hard_conflicts(
        self,
        scheduled: ScheduledSession,
        slot: TimeSlot,
        room: Room,
        scheduled_items: list[ScheduledSession],
    ) -> list[str]:
        conflicts: list[str] = []
        for other in scheduled_items:
            if other.session_id == scheduled.session_id:
                continue
            if other.day != slot.day or not weeks_conflict(other.week_pattern, slot.week_pattern):
                continue
            if not intervals_overlap(other.start_time, other.end_time, slot.start_time, slot.end_time):
                continue
            if other.room_id == room.id:
                conflicts.append("Room unavailable.")
            if scheduled.staff_id and other.staff_id == scheduled.staff_id:
                conflicts.append("Staff unavailable.")
            if scheduled.session.student_group_id and other.session.student_group_id == scheduled.session.student_group_id:
                conflicts.append("Student group unavailable.")
        return conflicts

    def _same_assignment(self, scheduled: ScheduledSession, slot: TimeSlot, room: Room) -> bool:
        return (
            scheduled.day == slot.day
            and scheduled.start_time == slot.start_time
            and scheduled.end_time == slot.end_time
            and scheduled.week_pattern == slot.week_pattern
            and scheduled.room_id == room.id
        )

    def _affected_session_ids(self, violation: ConstraintViolation) -> list[int]:
        if not violation.affected_session_ids:
            return []
        ids: list[int] = []
        for raw in violation.affected_session_ids.split(","):
            try:
                ids.append(int(raw))
            except ValueError:
                continue
        return ids

    def _day_index(self, day: str) -> int:
        return DAY_ORDER.index(day) if day in DAY_ORDER else len(DAY_ORDER)
