"""Post-generation constraint checks for scheduled sessions.

The solver avoids known hard clashes, and this service records hard/soft issues
for the review and validation pages after a timetable has been generated.
"""

from __future__ import annotations

from app.models.constraint_violation import ConstraintViolation
from app.models.room import Room
from app.models.scheduled_session import ScheduledSession
from app.models.student_group import StudentGroup
from app.services.compatibility import (
    delivery_room_compatible,
    intervals_overlap,
    is_online_mode,
    session_weeks_conflict,
    time_to_minutes,
)
from app.services.scheduling_constants import (
    DEFAULT_SOFT_CONSTRAINT_WEIGHTS,
    LONG_CONSECUTIVE_DAY_MINUTES,
    SHORT_CAMPUS_DAY_MAX_MINUTES,
    TUTOR_IDLE_GAP_MINUTES,
)
from app.services.scheduling_rules import required_room_codes, required_student_group_codes
from sqlalchemy.orm import Session as DbSession


class ConstraintService:
    def check_and_store(
        self,
        db: DbSession,
        schedule_run_id: int,
        soft_constraint_weights: dict[str, int] | None = None,
    ) -> dict:
        db.query(ConstraintViolation).filter_by(schedule_run_id=schedule_run_id).delete()
        violations = self.check_schedule(db, schedule_run_id)
        for violation in violations:
            db.add(
                ConstraintViolation(
                    schedule_run_id=schedule_run_id,
                    constraint_code=violation["constraint_code"],
                    severity=violation["severity"],
                    message=violation["message"],
                    affected_session_ids=",".join(str(item) for item in violation["affected_session_ids"]),
                )
            )
        db.flush()
        hard_count = sum(1 for item in violations if item["severity"] == "HARD")
        soft_count = sum(1 for item in violations if item["severity"] == "SOFT")
        weights = soft_constraint_weights or {}
        weighted_soft_score = sum(
            weights.get(item["constraint_code"], DEFAULT_SOFT_CONSTRAINT_WEIGHTS.get(item["constraint_code"], 1))
            for item in violations
            if item["severity"] == "SOFT"
        )
        return {
            "violations": violations,
            "hard_violation_count": hard_count,
            "soft_warning_count": soft_count,
            "weighted_soft_score": weighted_soft_score,
        }

    def check_schedule(self, db: DbSession, schedule_run_id: int) -> list[dict]:
        scheduled = (
            db.query(ScheduledSession)
            .filter(
                ScheduledSession.schedule_run_id == schedule_run_id,
                ScheduledSession.included_in_final.is_(True),
            )
            .order_by(ScheduledSession.day, ScheduledSession.start_time)
            .all()
        )
        room_labels = {item.id: item.room_code for item in db.query(Room).all()}
        group_ids_by_code = {item.group_code.lower(): item.id for item in db.query(StudentGroup).all()}
        group_labels = {item.id: item.group_code for item in db.query(StudentGroup).all()}
        violations: list[dict] = []
        self._hard_double_booking_checks(scheduled, violations, room_labels, group_ids_by_code, group_labels)
        self._hard_staff_double_booking_checks(scheduled, violations)
        self._hard_quality_checks(scheduled, violations)
        self._soft_checks(scheduled, violations, group_ids_by_code)
        return violations

    def _hard_double_booking_checks(
        self,
        scheduled: list[ScheduledSession],
        violations: list[dict],
        room_labels: dict[int, str],
        group_ids_by_code: dict[str, int],
        group_labels: dict[int, str],
    ) -> None:
        pairs = [
            (
                "ROOM_DOUBLE_BOOKING",
                lambda item: self._scheduled_room_ids(item),
                lambda key: f"Room {room_labels.get(key, key)}",
            ),
            (
                "STUDENT_GROUP_DOUBLE_BOOKING",
                lambda item: self._scheduled_group_ids(item, group_ids_by_code),
                lambda key: f"Student group {group_labels.get(key, key)}",
            ),
        ]
        for code, key_func, label_func in pairs:
            grouped: dict[int, list[ScheduledSession]] = {}
            for item in scheduled:
                for key in key_func(item):
                    grouped.setdefault(key, []).append(item)
            for key, items in grouped.items():
                for index, left in enumerate(items):
                    for right in items[index + 1 :]:
                        if self._both_lab_requirements(left, right):
                            continue
                        if self._scheduled_conflict(left, right):
                            violations.append(
                                {
                                    "constraint_code": code,
                                    "severity": "HARD",
                                    "message": f"{label_func(key)} is assigned to {self._module_label(left)} and {self._module_label(right)} on {left.day} {left.start_time}-{left.end_time}.",
                                    "affected_session_ids": [left.session_id, right.session_id],
                                }
                            )

    def _hard_staff_double_booking_checks(self, scheduled: list[ScheduledSession], violations: list[dict]) -> None:
        grouped: dict[int, list[ScheduledSession]] = {}
        labels: dict[int, str] = {}
        for item in scheduled:
            for staff_id, staff_label in self._session_staff_labels(item):
                grouped.setdefault(staff_id, []).append(item)
                labels[staff_id] = staff_label
        seen: set[tuple[int, int, int]] = set()
        for staff_id, items in grouped.items():
            for index, left in enumerate(items):
                for right in items[index + 1 :]:
                    if self._both_lab_requirements(left, right):
                        continue
                    if not self._scheduled_conflict(left, right):
                        continue
                    pair = (staff_id, min(left.session_id, right.session_id), max(left.session_id, right.session_id))
                    if pair in seen:
                        continue
                    seen.add(pair)
                    violations.append(
                        {
                            "constraint_code": "STAFF_DOUBLE_BOOKING",
                            "severity": "HARD",
                            "message": f"Staff {labels.get(staff_id, staff_id)} is assigned to {self._module_label(left)} and {self._module_label(right)} on {left.day} {left.start_time}-{left.end_time}.",
                            "affected_session_ids": [left.session_id, right.session_id],
                        }
                    )

    def _hard_quality_checks(self, scheduled: list[ScheduledSession], violations: list[dict]) -> None:
        for item in scheduled:
            if item.session.is_lab_requirement:
                continue
            if (
                item.session.exact_class_size
                and len(required_room_codes(item.session)) <= 1
                and item.room.capacity < item.session.exact_class_size
            ):
                violations.append(
                    {
                        "constraint_code": "ROOM_CAPACITY_MISMATCH",
                        "severity": "HARD",
                        "message": f"Room {item.room.room_code} capacity {item.room.capacity} is below class size {item.session.exact_class_size}.",
                        "affected_session_ids": [item.session_id],
                    }
                )
            if not delivery_room_compatible(item.session, item.room):
                violations.append(
                    {
                        "constraint_code": "DELIVERY_ROOM_MISMATCH",
                        "severity": "HARD",
                        "message": f"{item.session.delivery_mode} session {self._module_label(item)} is placed in incompatible room {item.room.room_code}.",
                        "affected_session_ids": [item.session_id],
                    }
                )
            required_codes = required_room_codes(item.session)
            if required_codes and item.room.room_code.lower() not in {code.lower() for code in required_codes}:
                violations.append(
                    {
                        "constraint_code": "REQUIRED_ROOM_MISMATCH",
                        "severity": "HARD",
                        "message": f"{self._module_label(item)} must use one of {', '.join(required_codes)} but is placed in {item.room.room_code}.",
                        "affected_session_ids": [item.session_id],
                    }
                )

    def _both_lab_requirements(self, left: ScheduledSession, right: ScheduledSession) -> bool:
        return bool(left.session and right.session and left.session.is_lab_requirement and right.session.is_lab_requirement)

    def _soft_checks(
        self,
        scheduled: list[ScheduledSession],
        violations: list[dict],
        group_ids_by_code: dict[str, int],
    ) -> None:
        self._tutor_gap_checks(scheduled, violations)
        self._student_day_checks(scheduled, violations, group_ids_by_code)
        self._adjacent_switch_checks(scheduled, violations, group_ids_by_code)
        for item in scheduled:
            if is_online_mode(item.session.delivery_mode) and item.day not in {"Monday", "Tuesday"}:
                violations.append(
                    {
                        "constraint_code": "ONLINE_NOT_MON_TUE",
                        "severity": "SOFT",
                        "message": f"Online session {self._module_label(item)} is scheduled on {item.day}.",
                        "affected_session_ids": [item.session_id],
                    }
                )

    def _tutor_gap_checks(self, scheduled: list[ScheduledSession], violations: list[dict]) -> None:
        grouped: dict[tuple[int, str], list[ScheduledSession]] = {}
        for item in scheduled:
            for staff_id, _ in self._session_staff_labels(item):
                grouped.setdefault((staff_id, item.day), []).append(item)
        for items in grouped.values():
            ordered = sorted(items, key=lambda item: item.start_time)
            for left, right in zip(ordered, ordered[1:]):
                gap = (time_to_minutes(right.start_time) or 0) - (time_to_minutes(left.end_time) or 0)
                if gap > TUTOR_IDLE_GAP_MINUTES:
                    violations.append(
                        {
                            "constraint_code": "TUTOR_IDLE_GAP",
                            "severity": "SOFT",
                            "message": f"Tutor has an idle gap longer than 2 hours on {left.day}.",
                            "affected_session_ids": [left.session_id, right.session_id],
                        }
                    )

    def _student_day_checks(
        self,
        scheduled: list[ScheduledSession],
        violations: list[dict],
        group_ids_by_code: dict[str, int],
    ) -> None:
        grouped: dict[tuple[int, str], list[ScheduledSession]] = {}
        for item in scheduled:
            for group_id in self._scheduled_group_ids(item, group_ids_by_code):
                grouped.setdefault((group_id, item.day), []).append(item)
        for items in grouped.values():
            ordered = sorted(items, key=lambda item: item.start_time)
            campus_minutes = sum(
                (time_to_minutes(item.end_time) or 0) - (time_to_minutes(item.start_time) or 0)
                for item in ordered
                if not item.room.is_virtual
            )
            if 0 < campus_minutes <= SHORT_CAMPUS_DAY_MAX_MINUTES:
                violations.append(
                    {
                        "constraint_code": "SHORT_CAMPUS_DAY",
                        "severity": "SOFT",
                        "message": f"Student group has only {campus_minutes // 60} campus hour(s) on {ordered[0].day}.",
                        "affected_session_ids": [item.session_id for item in ordered if not item.room.is_virtual],
                    }
                )

            current_start = None
            current_end = None
            current_ids: list[int] = []
            for item in ordered:
                start = time_to_minutes(item.start_time) or 0
                end = time_to_minutes(item.end_time) or 0
                if current_end is None or start > current_end:
                    current_start = start
                    current_end = end
                    current_ids = [item.session_id]
                else:
                    current_end = max(current_end, end)
                    current_ids.append(item.session_id)
                if current_start is not None and current_end - current_start > LONG_CONSECUTIVE_DAY_MINUTES:
                    violations.append(
                        {
                            "constraint_code": "LONG_CONSECUTIVE_DAY",
                            "severity": "SOFT",
                            "message": f"Student group has more than 4 consecutive teaching hours on {item.day}.",
                            "affected_session_ids": current_ids,
                        }
                    )
                    break

    def _adjacent_switch_checks(
        self,
        scheduled: list[ScheduledSession],
        violations: list[dict],
        group_ids_by_code: dict[str, int],
    ) -> None:
        def add_checks(grouped: dict[tuple[int, str], list[ScheduledSession]], label: str) -> None:
            for items in grouped.values():
                ordered = sorted(items, key=lambda item: item.start_time)
                for left, right in zip(ordered, ordered[1:]):
                    if left.end_time != right.start_time:
                        continue
                    left_online = left.room.is_virtual or is_online_mode(left.session.delivery_mode)
                    right_online = right.room.is_virtual or is_online_mode(right.session.delivery_mode)
                    if left_online != right_online:
                        violations.append(
                            {
                                "constraint_code": "ONLINE_F2F_ADJACENT_SWITCH",
                                "severity": "SOFT",
                                "message": f"{label} switches between online and face-to-face sessions with no gap on {left.day}.",
                                "affected_session_ids": [left.session_id, right.session_id],
                            }
                        )

        by_staff: dict[tuple[int, str], list[ScheduledSession]] = {}
        by_group: dict[tuple[int, str], list[ScheduledSession]] = {}
        for item in scheduled:
            for staff_id, _ in self._session_staff_labels(item):
                by_staff.setdefault((staff_id, item.day), []).append(item)
            for group_id in self._scheduled_group_ids(item, group_ids_by_code):
                by_group.setdefault((group_id, item.day), []).append(item)
        add_checks(by_staff, "Tutor")
        add_checks(by_group, "Student group")

    def _session_staff_labels(self, item: ScheduledSession) -> list[tuple[int, str]]:
        labels = []
        for assignment in getattr(item.session, "staff_assignments", []) or []:
            if assignment.staff_id is None:
                continue
            staff_label = assignment.staff.staff_name if assignment.staff else str(assignment.staff_id)
            labels.append((assignment.staff_id, staff_label))
        if not labels and item.staff_id:
            staff_label = item.session.staff.staff_name if item.session and item.session.staff else str(item.staff_id)
            labels.append((item.staff_id, staff_label))
        return labels

    def _scheduled_conflict(self, left: ScheduledSession, right: ScheduledSession) -> bool:
        return (
            left.day == right.day
            and session_weeks_conflict(left.session, left.time_slot, right.session, right.time_slot)
            and intervals_overlap(left.start_time, left.end_time, right.start_time, right.end_time)
        )

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

    def _module_label(self, item: ScheduledSession) -> str:
        module = item.session.module.module_code if item.session.module else item.session.requirement_id
        return module or f"session {item.session_id}"
