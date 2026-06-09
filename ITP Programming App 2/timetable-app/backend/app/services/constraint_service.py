"""Post-generation constraint checks for scheduled sessions.

The solver avoids known hard clashes, and this service records hard/soft issues
for the review and validation pages after a timetable has been generated.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session as DbSession

from app.models.constraint_violation import ConstraintViolation
from app.models.rule import Rule
from app.models.scheduled_session import ScheduledSession
from app.services.compatibility import (
    delivery_room_compatible,
    intervals_overlap,
    is_online_mode,
    normalize_token,
    time_to_minutes,
    weeks_conflict,
)
from app.services.scheduling_rules import LUNCH_BREAK_WINDOWS


@dataclass(frozen=True)
class RuleConfig:
    rule_id: str
    severity: str
    params: dict[str, Any]
    label: str = ""
    description: str | None = None


@dataclass(frozen=True)
class RuleEvaluation:
    rule_id: str
    severity: str
    message: str
    affected_session_ids: list[int]


class ConstraintValidator:
    """Executes active data-driven rules against candidate and scheduled slots."""

    DEFAULT_RULES = [
        RuleConfig(
            rule_id="CLASS_AFTER_1700",
            severity="SOFT",
            params={"limit": 1700},
            label="Class After 17:00",
            description="Flags sessions that end after the configured latest teaching time.",
        )
    ]

    def default_active_rules(self) -> list[RuleConfig]:
        return list(self.DEFAULT_RULES)

    def active_rules(self, db: DbSession) -> list[RuleConfig]:
        return [self._row_to_config(row) for row in db.query(Rule).filter_by(is_enabled=True).all()]

    def assignment_penalty_codes(self, assignment: dict, active_rules: list[RuleConfig]) -> list[str]:
        return [
            rule.rule_id
            for rule in active_rules
            if self._assignment_rule_triggered(rule, assignment)
        ]

    def scheduled_violations(
        self,
        item: ScheduledSession,
        active_rules: list[RuleConfig],
        session_label: str,
    ) -> list[RuleEvaluation]:
        evaluations: list[RuleEvaluation] = []
        for rule in active_rules:
            if rule.rule_id != "CLASS_AFTER_1700":
                continue
            limit = self._rule_limit_minutes(rule)
            end_min = time_to_minutes(item.end_time) or 0
            if end_min > limit:
                evaluations.append(
                    RuleEvaluation(
                        rule_id=rule.rule_id,
                        severity=rule.severity,
                        message=f"Session {session_label} ends after {self._format_minutes(limit)}.",
                        affected_session_ids=[item.session_id],
                    )
                )
        return evaluations

    def _assignment_rule_triggered(self, rule: RuleConfig, assignment: dict) -> bool:
        if rule.rule_id != "CLASS_AFTER_1700":
            return False
        slot = assignment["time_slot"]
        limit = self._rule_limit_minutes(rule)
        return (time_to_minutes(slot.end_time) or 0) > limit

    def _row_to_config(self, row: Rule) -> RuleConfig:
        try:
            params = json.loads(row.params_json or "{}")
        except json.JSONDecodeError:
            params = {}
        if not isinstance(params, dict):
            params = {}
        return RuleConfig(
            rule_id=row.rule_id,
            severity=(normalize_token(row.severity) or "SOFT").upper(),
            params=params,
            label=row.label,
            description=row.description,
        )

    def _rule_limit_minutes(self, rule: RuleConfig) -> int:
        raw_value = rule.params.get("limit", 1700)
        if isinstance(raw_value, str) and ":" in raw_value:
            parsed = time_to_minutes(raw_value)
            return parsed if parsed is not None else 17 * 60
        try:
            numeric = int(raw_value)
        except (TypeError, ValueError):
            return 17 * 60
        if numeric > 1440:
            hours = numeric // 100
            minutes = numeric % 100
            if 0 <= hours <= 23 and 0 <= minutes < 60:
                return hours * 60 + minutes
        return numeric

    def _format_minutes(self, minutes: int) -> str:
        return f"{minutes // 60:02d}:{minutes % 60:02d}"


class ConstraintService:
    def __init__(self, rule_validator: ConstraintValidator | None = None) -> None:
        self.rule_validator = rule_validator or ConstraintValidator()

    def active_rules(self, db: DbSession) -> list[RuleConfig]:
        return self.rule_validator.active_rules(db)

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
            weights.get(item["constraint_code"], 1)
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
            .filter_by(schedule_run_id=schedule_run_id)
            .order_by(ScheduledSession.day, ScheduledSession.start_time)
            .all()
        )
        violations: list[dict] = []
        active_rules = self.active_rules(db)
        self._hard_double_booking_checks(scheduled, violations)
        self._hard_quality_checks(scheduled, violations)
        self._hard_lunch_break_checks(scheduled, violations)
        self._soft_checks(scheduled, violations, active_rules)
        return violations

    def _hard_double_booking_checks(self, scheduled: list[ScheduledSession], violations: list[dict]) -> None:
        pairs = [
            (
                "ROOM_DOUBLE_BOOKING",
                lambda item: item.room_id,
                lambda item: f"Room {item.room.room_code}",
            ),
            (
                "STAFF_DOUBLE_BOOKING",
                lambda item: item.staff_id,
                lambda item: f"Staff {item.session.staff.staff_name if item.session.staff else item.staff_id}",
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

            start_min = time_to_minutes(item.start_time) or 0
            end_min = time_to_minutes(item.end_time) or 0

            if item.day == "Wednesday" and end_min > 780:
                violations.append(
                    {
                        "constraint_code": "WEDNESDAY_AFTERNOON_BLOCKED",
                        "severity": "HARD",
                        "message": f"Session {self._module_label(item)} is scheduled on Wednesday afternoon.",
                        "affected_session_ids": [item.session_id],
                    }
                )
            if item.day == "Friday" and start_min < 840 and end_min > 720:
                violations.append(
                    {
                        "constraint_code": "FRIDAY_PROTECTED_WINDOW",
                        "severity": "HARD",
                        "message": f"Session {self._module_label(item)} overlaps with the Friday 12:00-14:00 protected window.",
                        "affected_session_ids": [item.session_id],
                    }
                )
            if item.day == "Friday" and end_min > 1020:
                violations.append(
                    {
                        "constraint_code": "FRIDAY_LATE_CLASS",
                        "severity": "HARD",
                        "message": f"Session {self._module_label(item)} is scheduled on Friday after 17:00.",
                        "affected_session_ids": [item.session_id],
                    }
                )

    def _hard_lunch_break_checks(self, scheduled: list[ScheduledSession], violations: list[dict]) -> None:
        checks = [
            (
                "STAFF_LUNCH_BREAK",
                lambda item: item.staff_id,
                lambda item: f"Staff {item.session.staff.staff_name if item.session.staff else item.staff_id}",
            ),
            (
                "STUDENT_GROUP_LUNCH_BREAK",
                lambda item: item.session.student_group_id,
                lambda item: f"Student group {item.session.student_group.group_code if item.session.student_group else item.session.student_group_id}",
            ),
        ]
        for code, key_func, label_func in checks:
            grouped: dict[tuple[int, str, str], list[ScheduledSession]] = {}
            for item in scheduled:
                key = key_func(item)
                if key is None:
                    continue
                for week_pattern in ("Odd", "Even"):
                    if weeks_conflict(item.week_pattern, week_pattern):
                        grouped.setdefault((key, item.day, week_pattern), []).append(item)

            for (_, day, week_pattern), items in grouped.items():
                if self._has_lunch_break(items):
                    continue
                affected = sorted(
                    {
                        item.session_id
                        for item in items
                        if self._scheduled_overlaps_window(item, (11 * 60, 14 * 60))
                    }
                )
                violations.append(
                    {
                        "constraint_code": code,
                        "severity": "HARD",
                        "message": f"{label_func(items[0])} has no 1-hour lunch break between 11:00 and 14:00 on {day} ({week_pattern} weeks).",
                        "affected_session_ids": affected or [item.session_id for item in items],
                    }
                )

    def _soft_checks(
        self,
        scheduled: list[ScheduledSession],
        violations: list[dict],
        active_rules: list[RuleConfig],
    ) -> None:
        self._tutor_gap_checks(scheduled, violations)
        self._student_day_checks(scheduled, violations)
        self._adjacent_switch_checks(scheduled, violations)
        for item in scheduled:
            start_min = time_to_minutes(item.start_time) or 0
            end_min = time_to_minutes(item.end_time) or 0
            
            if is_online_mode(item.session.delivery_mode) and item.day not in {"Monday", "Tuesday"}:
                violations.append(
                    {
                        "constraint_code": "ONLINE_NOT_MON_TUE",
                        "severity": "SOFT",
                        "message": f"Online session {self._module_label(item)} is scheduled on {item.day}.",
                        "affected_session_ids": [item.session_id],
                    }
                )
            if not item.room.is_virtual and item.room.capacity > 0:
                class_size = item.session.exact_class_size or 0
                if class_size / item.room.capacity < 0.6:
                    violations.append(
                        {
                            "constraint_code": "LOW_ROOM_UTILISATION",
                            "severity": "SOFT",
                            "message": f"Room {item.room.room_code} utilisation is below 60% for session {self._module_label(item)}.",
                            "affected_session_ids": [item.session_id],
                        }
                    )
            if item.session.student_group_id and (start_min <= 540 or end_min >= 1080):
                violations.append(
                    {
                        "constraint_code": "EXTREME_TIME_SLOT",
                        "severity": "SOFT",
                        "message": f"Student group session {self._module_label(item)} is scheduled in the very first or last slot of the day.",
                        "affected_session_ids": [item.session_id],
                    }
                )
            for evaluation in self.rule_validator.scheduled_violations(item, active_rules, self._module_label(item)):
                violations.append(
                    {
                        "constraint_code": evaluation.rule_id,
                        "severity": evaluation.severity,
                        "message": evaluation.message,
                        "affected_session_ids": evaluation.affected_session_ids,
                    }
                )

    def _tutor_gap_checks(self, scheduled: list[ScheduledSession], violations: list[dict]) -> None:
        grouped: dict[tuple[int, str], list[ScheduledSession]] = {}
        for item in scheduled:
            if item.staff_id:
                grouped.setdefault((item.staff_id, item.day), []).append(item)
        for items in grouped.values():
            ordered = sorted(items, key=lambda item: item.start_time)
            for left, right in zip(ordered, ordered[1:]):
                gap = (time_to_minutes(right.start_time) or 0) - (time_to_minutes(left.end_time) or 0)
                if gap > 120:
                    violations.append(
                        {
                            "constraint_code": "TUTOR_IDLE_GAP",
                            "severity": "SOFT",
                            "message": f"Tutor has an idle gap longer than 2 hours on {left.day}.",
                            "affected_session_ids": [left.session_id, right.session_id],
                        }
                    )
                elif gap > 0:
                    violations.append(
                        {
                            "constraint_code": "WASTED_FREE_SLOT",
                            "severity": "SOFT",
                            "message": f"Tutor has a wasted free slot between classes on {left.day}.",
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
            if 0 < campus_minutes <= 120:
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
                if current_start is not None:
                    span = current_end - current_start
                    if span > 240:
                        violations.append(
                            {
                                "constraint_code": "LONG_CONSECUTIVE_DAY",
                                "severity": "SOFT",
                                "message": f"Student group has more than 4 consecutive teaching hours on {item.day}.",
                                "affected_session_ids": current_ids,
                            }
                        )
                        break
                    elif span > 180:
                        violations.append(
                            {
                                "constraint_code": "THREE_HR_CONSECUTIVE",
                                "severity": "SOFT",
                                "message": f"Student group has more than 3 consecutive teaching hours on {item.day}.",
                                "affected_session_ids": current_ids,
                            }
                        )

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
            if item.staff_id:
                by_staff.setdefault((item.staff_id, item.day), []).append(item)
            group_id = item.session.student_group_id
            if group_id:
                by_group.setdefault((group_id, item.day), []).append(item)
        add_checks(by_staff, "Tutor")
        add_checks(by_group, "Student group")

    def _scheduled_conflict(self, left: ScheduledSession, right: ScheduledSession) -> bool:
        return (
            left.day == right.day
            and weeks_conflict(left.week_pattern, right.week_pattern)
            and intervals_overlap(left.start_time, left.end_time, right.start_time, right.end_time)
        )

    def _module_label(self, item: ScheduledSession) -> str:
        module = item.session.module.module_code if item.session.module else item.session.requirement_id
        return module or f"session {item.session_id}"

    def _has_lunch_break(self, items: list[ScheduledSession]) -> bool:
        for window in LUNCH_BREAK_WINDOWS:
            if all(not self._scheduled_overlaps_window(item, window) for item in items):
                return True
        return False

    def _scheduled_overlaps_window(self, item: ScheduledSession, window: tuple[int, int]) -> bool:
        start = time_to_minutes(item.start_time) or 0
        end = time_to_minutes(item.end_time) or 0
        window_start, window_end = window
        return start < window_end and window_start < end
