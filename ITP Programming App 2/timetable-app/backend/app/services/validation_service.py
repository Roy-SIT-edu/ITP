from __future__ import annotations

from sqlalchemy.orm import Session as DbSession

from app.models.session import Session
from app.models.time_slot import TimeSlot
from app.services.compatibility import (
    ALLOWED_DELIVERY_MODES,
    ALLOWED_WEEK_PATTERNS,
    clean_text,
    normalize_token,
    parse_day_list,
)


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

        for session in sessions:
            row = session.source_row_no or session.id
            self._required_checks(session, row, errors)
            self._value_checks(db, session, row, errors, warnings)

        return {
            "is_valid": len(errors) == 0,
            "error_count": len(errors),
            "warning_count": len(warnings),
            "errors": errors,
            "warnings": warnings,
        }

    def _required_checks(self, session: Session, row: int, errors: list[dict]) -> None:
        for field_name, attr in self.REQUIRED_FIELDS:
            value = self._read_attr(session, attr)
            if value is None or value == "":
                errors.append(
                    {
                        "row": row,
                        "field": field_name,
                        "message": f"{field_name} is required",
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
        if session.exact_class_size is None or session.exact_class_size <= 0:
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
        if (
            session.start_week is not None
            and session.end_week is not None
            and session.start_week > session.end_week
        ):
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
        if delivery_mode in {"face to face", "f2f"} and campus_mode in {"virtual", "online"}:
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
                    .first()
                )
                if not match:
                    errors.append(
                        {
                            "row": row,
                            "field": "Fixed Start Time",
                            "message": "No default time slot matches the fixed day and time",
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
