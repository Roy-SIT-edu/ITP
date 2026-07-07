"""Validation service for saved requirements and generated schedule quality.

Upload/manual entry validation blocks bad data before save; this service reports
the health of what is currently saved and any issues from the latest run.
"""

from __future__ import annotations

from app.models.constraint_violation import ConstraintViolation
from app.models.room import Room
from app.models.schedule_run import ScheduleRun
from app.models.session import Session
from app.models.time_slot import TimeSlot
from app.services.compatibility import (
    ALLOWED_DELIVERY_MODES,
    ALLOWED_WEEK_PATTERNS,
    clean_text,
    normalize_token,
    parse_day_list,
    weeks_conflict,
)
from app.services.lab_requirement_service import LabRequirementService
from app.services.requirement_input_service import RequirementInputService
from app.services.scheduling_rules import (
    candidate_room_allowed,
    fixed_sessions_conflict,
    session_label,
    staff_label,
    student_group_label,
)
from sqlalchemy import func
from sqlalchemy.orm import Session as DbSession


class ValidationService:
    LAB_OPTIONAL_FIELDS = {
        "Year",
        "Exact Class Size",
        "Staff 1 ID or Staff 1 Name",
        "Start Week",
        "End Week",
    }
    REQUIRED_FIELDS = [
        ("Requirement ID", "requirement_id"),
        ("Programme", "programme_id"),
        ("Year", "student_group.year"),
        ("Student Group Code", "student_group_id"),
        ("Module Code", "module_id"),
        ("Class Type", "class_type"),
        ("Delivery Mode", "delivery_mode"),
        ("Campus Mode", "campus_mode"),
        ("Venue Type Required", "venue_type_required"),
        ("Duration", "duration_minutes"),
        ("Sessions Per Week", "sessions_per_week"),
        ("Exact Class Size", "exact_class_size"),
        ("Staff 1 ID or Staff 1 Name", "staff_id"),
        ("Start Week", "start_week"),
        ("End Week", "end_week"),
        ("Week Pattern", "week_pattern"),
        ("Scheduling Type", "scheduling_type"),
    ]

    def validate_latest(self, db: DbSession) -> dict:
        errors: list[dict] = []
        warnings: list[dict] = []
        active_lab_requirement_ids = LabRequirementService().active_requirement_ids(db)
        sessions = [
            item
            for item in db.query(Session).order_by(Session.id).all()
            if not item.is_lab_requirement or item.requirement_id in active_lab_requirement_ids
        ]
        self._duplicate_requirement_checks(sessions, errors)

        for session in sessions:
            row = session.source_row_no or session.id
            self._required_checks(session, row, errors)
            self._value_checks(db, session, row, errors, warnings)
        self._fixed_hard_clash_checks(db, sessions, errors)

        result = {
            "is_valid": len(errors) == 0,
            "error_count": len(errors),
            "warning_count": len(warnings),
            "errors": errors,
            "warnings": warnings,
            "schedule_issues": self._schedule_issue_summary(db),
        }

        return result

    def _schedule_issue_summary(self, db: DbSession) -> dict:
        latest_run = db.query(ScheduleRun).order_by(ScheduleRun.id.desc()).first()
        if not latest_run:
            return {"schedule_run_id": None, "hard_count": 0, "soft_count": 0, "total": 0, "breakdown": []}

        counts = (
            db.query(ConstraintViolation.severity, func.count(ConstraintViolation.id))
            .filter(ConstraintViolation.schedule_run_id == latest_run.id)
            .group_by(ConstraintViolation.severity)
            .all()
        )
        hard = 0
        soft = 0
        for severity, count in counts:
            if (severity or "").upper() == "HARD":
                hard = count
            else:
                soft = count

        breakdown = (
            db.query(ConstraintViolation.constraint_code, ConstraintViolation.severity, func.count(ConstraintViolation.id))
            .filter(ConstraintViolation.schedule_run_id == latest_run.id)
            .group_by(ConstraintViolation.constraint_code, ConstraintViolation.severity)
            .all()
        )

        return {
            "schedule_run_id": latest_run.id,
            "hard_count": int(hard),
            "soft_count": int(soft),
            "total": int(hard + soft),
            "breakdown": [{"constraint_code": code, "severity": severity, "count": int(count)} for code, severity, count in breakdown],
        }

    def _required_checks(self, session: Session, row: int, errors: list[dict]) -> None:
        for field_name, attr in self.REQUIRED_FIELDS:
            if session.is_lab_requirement and field_name in self.LAB_OPTIONAL_FIELDS:
                continue
            value = self._read_attr(session, attr)
            if value is None or value == "":
                errors.append(
                    {
                        "row": row,
                        "field": field_name,
                        "message": f"{field_name} is required",
                    }
                )

    def _duplicate_requirement_checks(self, sessions: list[Session], errors: list[dict]) -> None:
        seen: dict[str, int] = {}
        for session in sessions:
            requirement_id = clean_text(session.requirement_id)
            if not requirement_id:
                continue
            key = requirement_id.lower()
            row = session.source_row_no or session.id
            if key in seen:
                errors.append(
                    {
                        "row": row,
                        "field": "Requirement ID",
                        "message": f"Duplicate Requirement ID '{requirement_id}' also appears on row {seen[key]}",
                    }
                )
            else:
                seen[key] = row

    def _fixed_hard_clash_checks(self, db: DbSession, sessions: list[Session], errors: list[dict]) -> None:
        fixed_sessions = [
            session
            for session in sessions
            if normalize_token(session.scheduling_type) == "fixed"
            and session.fixed_day
            and session.fixed_start_time
            and session.fixed_end_time
        ]
        seen_pairs: set[tuple[str, int, int]] = set()
        for index, left in enumerate(fixed_sessions):
            for right in fixed_sessions[index + 1 :]:
                if not fixed_sessions_conflict(left, right):
                    continue
                shared_staff = self._shared_staff_ids(left, right)
                if shared_staff:
                    self._append_fixed_clash(
                        errors,
                        "STAFF_DOUBLE_BOOKING",
                        "Fixed Time",
                        left,
                        right,
                        f"Staff {staff_label(left)} is fixed for both {session_label(left)} and {session_label(right)} at overlapping times.",
                        seen_pairs,
                    )
                if left.student_group_id and left.student_group_id == right.student_group_id:
                    self._append_fixed_clash(
                        errors,
                        "STUDENT_GROUP_DOUBLE_BOOKING",
                        "Fixed Time",
                        left,
                        right,
                        f"Student group {student_group_label(left)} is fixed for both {session_label(left)} and {session_label(right)} at overlapping times.",
                        seen_pairs,
                    )
        self._fixed_room_capacity_checks(db, fixed_sessions, errors)

    def _shared_staff_ids(self, left: Session, right: Session) -> set[int]:
        return set(self._session_staff_ids(left)) & set(self._session_staff_ids(right))

    def _session_staff_ids(self, session: Session) -> list[int]:
        ids = [assignment.staff_id for assignment in getattr(session, "staff_assignments", []) or [] if assignment.staff_id is not None]
        if not ids and session.staff_id is not None:
            ids.append(session.staff_id)
        return ids

    def _fixed_room_capacity_checks(self, db: DbSession, sessions: list[Session], errors: list[dict]) -> None:
        rooms = db.query(Room).all()
        groups: dict[tuple[str, str, str], list[Session]] = {}
        for session in sessions:
            groups.setdefault(
                (session.fixed_day or "", session.fixed_start_time or "", session.fixed_end_time or ""),
                [],
            ).append(session)

        seen_groups: set[tuple[int, ...]] = set()
        for group in groups.values():
            weekly = [session for session in group if normalize_token(session.week_pattern or "Weekly") not in {"odd", "even"}]
            odd = [session for session in group if normalize_token(session.week_pattern or "Weekly") == "odd"]
            even = [session for session in group if normalize_token(session.week_pattern or "Weekly") == "even"]
            for overlapping in [weekly, weekly + odd, weekly + even]:
                if len(overlapping) < 2:
                    continue
                key = tuple(sorted(session.id for session in overlapping))
                if key in seen_groups:
                    continue
                seen_groups.add(key)
                compatible_room_ids = {room.id for session in overlapping for room in rooms if candidate_room_allowed(session, room)}
                if len(overlapping) > len(compatible_room_ids):
                    first = overlapping[0]
                    labels = ", ".join(session_label(session) for session in overlapping)
                    errors.append(
                        {
                            "row": first.source_row_no or first.id,
                            "field": "Fixed Time",
                            "message": f"{len(overlapping)} fixed sessions overlap at {first.fixed_day} {first.fixed_start_time}-{first.fixed_end_time}, but only {len(compatible_room_ids)} compatible room(s) are available: {labels}.",
                            "requirement_id": first.requirement_id,
                            "conflict_session_ids": [session.id for session in overlapping],
                        }
                    )

    def _append_fixed_clash(
        self,
        errors: list[dict],
        code: str,
        field: str,
        left: Session,
        right: Session,
        message: str,
        seen_pairs: set[tuple[str, int, int]],
    ) -> None:
        pair = (code, min(left.id, right.id), max(left.id, right.id))
        if pair in seen_pairs:
            return
        seen_pairs.add(pair)
        errors.append(
            {
                "row": left.source_row_no or left.id,
                "field": field,
                "message": message,
                "requirement_id": left.requirement_id,
                "conflict_session_ids": [left.id, right.id],
            }
        )

    def _value_checks(
        self,
        db: DbSession,
        session: Session,
        row: int,
        errors: list[dict],
        warnings: list[dict],
    ) -> None:
        if not session.is_lab_requirement and (session.exact_class_size is None or session.exact_class_size <= 0):
            errors.append(
                {
                    "row": row,
                    "field": "Exact Class Size",
                    "message": "Exact Class Size must be numeric and greater than 0",
                }
            )
        if session.duration_minutes is None or session.duration_minutes <= 0:
            errors.append(
                {
                    "row": row,
                    "field": "Duration Hours",
                    "message": "Duration must be numeric and greater than 0",
                }
            )
        if session.start_week is not None and session.end_week is not None and session.start_week > session.end_week:
            errors.append(
                {
                    "row": row,
                    "field": "Start Week",
                    "message": "Start Week must be less than or equal to End Week",
                }
            )

        week_pattern = normalize_token(session.week_pattern)
        if week_pattern and week_pattern not in ALLOWED_WEEK_PATTERNS:
            errors.append(
                {
                    "row": row,
                    "field": "Week Pattern",
                    "message": "Week Pattern must be Weekly, Odd, Even, or Custom",
                }
            )

        delivery_mode = normalize_token(session.delivery_mode)
        if delivery_mode and delivery_mode not in ALLOWED_DELIVERY_MODES:
            errors.append(
                {
                    "row": row,
                    "field": "Delivery Mode",
                    "message": "Delivery Mode must be Face-to-face, Online, Hybrid, or Asynchronous",
                }
            )

        campus_mode = normalize_token(session.campus_mode)
        if delivery_mode in {"online", "asynchronous", "async"} and campus_mode not in {
            "online",
            "virtual",
            "remote",
        }:
            warnings.append(
                {
                    "row": row,
                    "field": "Campus Mode",
                    "message": "Online sessions should use online or virtual campus mode",
                }
            )
        if delivery_mode in {"face to face", "f2f", "physical", "in person"} and campus_mode in {"virtual", "online"}:
            errors.append(
                {
                    "row": row,
                    "field": "Campus Mode",
                    "message": "Face-to-face sessions should not use virtual-only campus mode",
                }
            )

        if normalize_token(session.scheduling_type) == "fixed":
            if not session.fixed_day:
                errors.append(
                    {
                        "row": row,
                        "field": "Fixed Day",
                        "message": "Fixed sessions must have a fixed day",
                    }
                )
            if not session.fixed_start_time or not session.fixed_end_time:
                errors.append(
                    {
                        "row": row,
                        "field": "Fixed Start Time",
                        "message": "Fixed sessions must have fixed start and end times",
                    }
                )
            if session.fixed_day and session.fixed_start_time and session.fixed_end_time:
                match = (
                    db.query(TimeSlot)
                    .filter(
                        TimeSlot.day == session.fixed_day,
                        TimeSlot.start_time == session.fixed_start_time,
                        TimeSlot.end_time == session.fixed_end_time,
                    )
                    .all()
                )
                if not any(weeks_conflict(slot.week_pattern, session.week_pattern) for slot in match):
                    errors.append(
                        {
                            "row": row,
                            "field": "Fixed Start Time",
                            "message": "No default time slot matches the fixed day, time, and week pattern",
                        }
                    )

        if (
            session.delivery_mode
            and session.campus_mode
            and session.venue_type_required
            and session.exact_class_size
            and not RequirementInputService().has_feasible_room_for_session(db, session)
        ):
            errors.append(
                {
                    "row": row,
                    "field": "Venue Type Required",
                    "message": "No room in the database matches this venue type, campus mode, delivery mode, and class size.",
                }
            )

        for field_name, values in [
            ("Preferred Days", parse_day_list(session.preferred_days)),
            ("Avoid Days", parse_day_list(session.avoid_days)),
        ]:
            invalid_days = [day for day in values if day not in {"Monday", "Tuesday", "Wednesday", "Thursday", "Friday"}]
            if invalid_days:
                warnings.append(
                    {
                        "row": row,
                        "field": field_name,
                        "message": f"Unrecognised day values: {', '.join(invalid_days)}",
                    }
                )

        remarks = clean_text(session.remarks) or ""
        if any(token in remarks.lower() for token in ["avoid", "prefer", "fixed", "before", "after"]):
            warnings.append(
                {
                    "row": row,
                    "field": "Remarks",
                    "message": "Remarks contain scheduling information that should be structured",
                }
            )

    def _read_attr(self, obj, dotted: str):
        current = obj
        for part in dotted.split("."):
            current = getattr(current, part, None)
            if current is None:
                return None
        return current
