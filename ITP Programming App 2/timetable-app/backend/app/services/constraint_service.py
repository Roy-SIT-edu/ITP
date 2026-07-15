"""Post-generation constraint checks for scheduled sessions.

The solver avoids known hard clashes, and this service records hard/soft issues
for the review and validation pages after a timetable has been generated.
"""

from __future__ import annotations

from app.models.constraint_violation import ConstraintViolation
from app.models.scheduled_session import ScheduledSession
from app.services.compatibility import (
    delivery_room_compatible,
    intervals_overlap,
    is_online_mode,
<<<<<<< Updated upstream
    normalize_token,
=======
    session_weeks_conflict,
>>>>>>> Stashed changes
    time_to_minutes,
    weeks_conflict,
)
from app.services.scheduling_constants import (
    DEFAULT_SOFT_CONSTRAINT_WEIGHTS,
    LONG_CONSECUTIVE_DAY_MINUTES,
    SHORT_CAMPUS_DAY_MAX_MINUTES,
    TUTOR_IDLE_GAP_MINUTES,
)
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
        violations: list[dict] = []
        self._hard_double_booking_checks(scheduled, violations)
        self._hard_staff_double_booking_checks(scheduled, violations)
        self._hard_quality_checks(scheduled, violations)
        self._soft_checks(scheduled, violations)
        return violations

    def _hard_double_booking_checks(self, scheduled: list[ScheduledSession], violations: list[dict]) -> None:
        pairs = [
            (
                "ROOM_DOUBLE_BOOKING",
                lambda item: item.room_id,
                lambda item: f"Room {item.room.room_code}",
            ),
            (
                "STUDENT_GROUP_DOUBLE_BOOKING",
                lambda item: item.session.student_group_id,
                lambda item: f"Student group {item.session.student_group.group_code if item.session.student_group else item.session.student_group_id}",
            ),
        ]
        for code, key_func, label_func in pairs:
            grouped: dict[int, list[ScheduledSession]] = {}
            for item in scheduled:
                key = key_func(item)
                if key is not None:
                    grouped.setdefault(key, []).append(item)
            for items in grouped.values():
                for index, left in enumerate(items):
                    for right in items[index + 1 :]:
                        if self._scheduled_conflict(left, right):
                            violations.append(
                                {
                                    "constraint_code": code,
                                    "severity": "HARD",
                                    "message": f"{label_func(left)} is assigned to {self._module_label(left)} and {self._module_label(right)} on {left.day} {left.start_time}-{left.end_time}.",
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
            if item.session.exact_class_size and item.room.capacity < item.session.exact_class_size:
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
<<<<<<< Updated upstream
            if normalize_token(item.session.scheduling_type) == "fixed":
                if (
                    item.session.fixed_day != item.day
                    or item.session.fixed_start_time != item.start_time
                    or item.session.fixed_end_time != item.end_time
                ):
                    violations.append(
                        {
                            "constraint_code": "INVALID_FIXED_TIME",
                            "severity": "HARD",
                            "message": f"Fixed session {self._module_label(item)} was not scheduled at its fixed day/time.",
                            "affected_session_ids": [item.session_id],
                        }
                    )
=======
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
>>>>>>> Stashed changes

    def _soft_checks(self, scheduled: list[ScheduledSession], violations: list[dict]) -> None:
        self._tutor_gap_checks(scheduled, violations)
        self._student_day_checks(scheduled, violations)
        self._adjacent_switch_checks(scheduled, violations)
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

    def _student_day_checks(self, scheduled: list[ScheduledSession], violations: list[dict]) -> None:
        grouped: dict[tuple[int, str], list[ScheduledSession]] = {}
        for item in scheduled:
            group_id = item.session.student_group_id
            if group_id:
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

    def _adjacent_switch_checks(self, scheduled: list[ScheduledSession], violations: list[dict]) -> None:
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
            group_id = item.session.student_group_id
            if group_id:
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
            and weeks_conflict(left.week_pattern, right.week_pattern)
            and intervals_overlap(left.start_time, left.end_time, right.start_time, right.end_time)
        )

    def _module_label(self, item: ScheduledSession) -> str:
        module = item.session.module.module_code if item.session.module else item.session.requirement_id
        return module or f"session {item.session_id}"
