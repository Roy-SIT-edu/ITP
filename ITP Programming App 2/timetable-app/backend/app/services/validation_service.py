"""Validation service for saved requirements and generated schedule quality.

Upload/manual entry validation blocks bad data before save; this service reports
the health of what is currently saved and any issues from the latest run.
"""

from __future__ import annotations

from sqlalchemy.orm import Session as DbSession
from sqlalchemy import func

from app.models.schedule_run import ScheduleRun
from app.models.constraint_violation import ConstraintViolation

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
from app.services.requirement_input_service import RequirementInputService


class ValidationService:
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
        sessions = db.query(Session).order_by(Session.id).all()
        self._duplicate_requirement_checks(sessions, errors)

        for session in sessions:
            row = session.source_row_no or session.id
            self._required_checks(session, row, errors)
            self._value_checks(db, session, row, errors, warnings)

        # Pre-solver fixed-session clash checks: detect two fixed sessions at same day/time that share staff or student group
        fixed_conflicts: list[tuple[int, int]] = []
        fixed_sessions = [s for s in sessions if (s.scheduling_type or "").lower() == "fixed" and s.fixed_day and s.fixed_start_time and s.fixed_end_time]
        by_slot: dict[tuple[str, str, str], list[Session]] = {}
        for s in fixed_sessions:
            key = (s.fixed_day, s.fixed_start_time, s.fixed_end_time)
            by_slot.setdefault(key, []).append(s)
        for (day, start, end), group in by_slot.items():
            if len(group) < 2:
                continue
            for i in range(len(group)):
                for j in range(i + 1, len(group)):
                    a = group[i]
                    b = group[j]
                    shares_staff = a.staff_id and b.staff_id and a.staff_id == b.staff_id
                    shares_group = a.student_group_id and b.student_group_id and a.student_group_id == b.student_group_id
                    if shares_staff or shares_group:
                        row_a = a.source_row_no or a.id
                        row_b = b.source_row_no or b.id
                        who = []
                        if shares_staff:
                            who.append("staff")
                        if shares_group:
                            who.append("student group")
                        who_text = " and ".join(who)
                        msg = f"Fixed sessions {a.requirement_id or a.id} and {b.requirement_id or b.id} are both fixed at {day} {start}-{end} and share {who_text} — this causes an unsatisfiable hard conflict."
                        self._append_error(errors, row_a, "Fixed Time", msg, a.requirement_id)
                        self._append_error(errors, row_b, "Fixed Time", msg, b.requirement_id)
                        # record pair (sorted) for schedule_issues breakdown
                        pair = (min(a.id, b.id), max(a.id, b.id))
                        if pair not in fixed_conflicts:
                            fixed_conflicts.append(pair)

        result = {
            "is_valid": len(errors) == 0,
            "error_count": len(errors),
            "warning_count": len(warnings),
            "errors": errors,
            "warnings": warnings,
        }

        # Add latest schedule violation counts (hard/soft)
        latest_run = db.query(ScheduleRun).order_by(ScheduleRun.id.desc()).first()
        if latest_run:
            counts = (
                db.query(ConstraintViolation.severity, func.count(ConstraintViolation.id))
                .filter(ConstraintViolation.schedule_run_id == latest_run.id)
                .group_by(ConstraintViolation.severity)
                .all()
            )
            hard = 0
            soft = 0
            for severity, cnt in counts:
                if (severity or "").upper() == "HARD":
                    hard = cnt
                else:
                    soft = cnt

            # breakdown by constraint code
            breakdown = (
                db.query(ConstraintViolation.constraint_code, ConstraintViolation.severity, func.count(ConstraintViolation.id))
                .filter(ConstraintViolation.schedule_run_id == latest_run.id)
                .group_by(ConstraintViolation.constraint_code, ConstraintViolation.severity)
                .all()
            )
            breakdown_list: list[dict] = []
            for code, severity, cnt in breakdown:
                breakdown_list.append({"constraint_code": code, "severity": severity, "count": int(cnt)})
            # include any pre-solver fixed_conflicts in the breakdown and counts
            if fixed_conflicts:
                fixed_count = len(fixed_conflicts)
                hard += fixed_count
                breakdown_list.append({"constraint_code": "INVALID_FIXED_TIME", "severity": "HARD", "count": fixed_count})

            result["schedule_issues"] = {
                "schedule_run_id": latest_run.id,
                "hard_count": int(hard),
                "soft_count": int(soft),
                "total": int(hard + soft),
                "breakdown": breakdown_list,
            }
        else:
            # No latest run; include pre-solver fixed_conflicts if present
            if fixed_conflicts:
                # Persist a lightweight ScheduleRun to attach validation-only violations
                run = ScheduleRun(status="VALIDATION", message="Validation-only fixed time conflicts")
                db.add(run)
                db.flush()

                # store each conflicting pair as a ConstraintViolation so frontend can list them
                for a_id, b_id in fixed_conflicts:
                    msg = f"Fixed sessions {a_id} and {b_id} are fixed at the same time and share staff/student group — unsatisfiable hard conflict."
                    db.add(
                        ConstraintViolation(
                            schedule_run_id=run.id,
                            constraint_code="INVALID_FIXED_TIME",
                            severity="HARD",
                            message=msg,
                            affected_session_ids=f"{a_id},{b_id}",
                        )
                    )
                db.commit()

                result["schedule_issues"] = {"schedule_run_id": run.id, "hard_count": len(fixed_conflicts), "soft_count": 0, "total": len(fixed_conflicts), "breakdown": [{"constraint_code": "INVALID_FIXED_TIME", "severity": "HARD", "count": len(fixed_conflicts)}]}
            else:
                result["schedule_issues"] = {"schedule_run_id": None, "hard_count": 0, "soft_count": 0, "total": 0, "breakdown": []}

        return result

    def _required_checks(self, session: Session, row: int, errors: list[dict]) -> None:
        for field_name, attr in self.REQUIRED_FIELDS:
            value = self._read_attr(session, attr)
            if value is None or value == "":
                self._append_error(
                    errors,
                    row,
                    field_name,
                    f"{field_name} is required",
                    session.requirement_id,
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
                self._append_error(
                    errors,
                    row,
                    "Requirement ID",
                    f"Duplicate Requirement ID '{requirement_id}' also appears on row {seen[key]}",
                    requirement_id,
                )
            else:
                seen[key] = row

    def _value_checks(
        self,
        db: DbSession,
        session: Session,
        row: int,
        errors: list[dict],
        warnings: list[dict],
    ) -> None:
        if session.exact_class_size is None or session.exact_class_size <= 0:
            self._append_error(
                errors,
                row,
                "Exact Class Size",
                "Exact Class Size must be numeric and greater than 0",
                session.requirement_id,
            )
        if session.duration_minutes is None or session.duration_minutes <= 0:
            self._append_error(
                errors,
                row,
                "Duration Hours",
                "Duration must be numeric and greater than 0",
                session.requirement_id,
            )
        if (
            session.start_week is not None
            and session.end_week is not None
            and session.start_week > session.end_week
        ):
            self._append_error(
                errors,
                row,
                "Start Week",
                "Start Week must be less than or equal to End Week",
                session.requirement_id,
            )

        week_pattern = normalize_token(session.week_pattern)
        if week_pattern and week_pattern not in ALLOWED_WEEK_PATTERNS:
            self._append_error(
                errors,
                row,
                "Week Pattern",
                "Week Pattern must be Weekly, Odd, Even, or Custom",
                session.requirement_id,
            )

        delivery_mode = normalize_token(session.delivery_mode)
        if delivery_mode and delivery_mode not in ALLOWED_DELIVERY_MODES:
            self._append_error(
                errors,
                row,
                "Delivery Mode",
                "Delivery Mode must be Face-to-face, Online, Hybrid, or Asynchronous",
                session.requirement_id,
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
                    "requirement_id": session.requirement_id,
                }
            )
        if delivery_mode in {"face to face", "f2f", "physical", "in person"} and campus_mode in {"virtual", "online"}:
            self._append_error(
                errors,
                row,
                "Campus Mode",
                "Face-to-face sessions should not use virtual-only campus mode",
                session.requirement_id,
            )

        if normalize_token(session.scheduling_type) == "fixed":
            if not session.fixed_day:
                self._append_error(
                    errors,
                    row,
                    "Fixed Day",
                    "Fixed sessions must have a fixed day",
                    session.requirement_id,
                )
            if not session.fixed_start_time or not session.fixed_end_time:
                self._append_error(
                    errors,
                    row,
                    "Fixed Start Time",
                    "Fixed sessions must have fixed start and end times",
                    session.requirement_id,
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
                    self._append_error(
                        errors,
                        row,
                        "Fixed Start Time",
                        "No default time slot matches the fixed day, time, and week pattern",
                        session.requirement_id,
                    )

        if (
            session.delivery_mode
            and session.campus_mode
            and session.venue_type_required
            and session.exact_class_size
            and not RequirementInputService().has_feasible_room_for_session(db, session)
        ):
            self._append_error(
                errors,
                row,
                "Venue Type Required",
                "No room in the database matches this venue type, campus mode, delivery mode, and class size.",
                session.requirement_id,
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
                        "requirement_id": session.requirement_id,
                    }
                )

        remarks = clean_text(session.remarks) or ""
        if any(token in remarks.lower() for token in ["avoid", "prefer", "fixed", "before", "after"]):
            warnings.append(
                {
                    "row": row,
                    "field": "Remarks",
                    "message": "Remarks contain scheduling information that should be structured",
                    "requirement_id": session.requirement_id,
                }
            )

    def _read_attr(self, obj, dotted: str):
        current = obj
        for part in dotted.split("."):
            current = getattr(current, part, None)
            if current is None:
                return None
        return current

    def _append_error(self, errors: list[dict], row: int, field: str, message: str, requirement_id: str | None = None) -> None:
        item = {
            "row": row,
            "field": field,
            "message": message,
        }
        if requirement_id is not None:
            item["requirement_id"] = requirement_id
        errors.append(item)
