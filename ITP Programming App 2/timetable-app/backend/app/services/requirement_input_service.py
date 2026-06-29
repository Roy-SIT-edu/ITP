"""Strict requirement validation shared by Excel import and manual editing.

The service converts external codes/names into internal IDs only after proving
the references exist and the row can be scheduled against current rooms/slots.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

from app.models.module import Module
from app.models.programme import Programme
from app.models.room import Room
from app.models.session import Session as RequirementSession
from app.models.session_staff import SessionStaff
from app.models.staff import Staff
from app.models.student_group import StudentGroup
from app.models.time_slot import TimeSlot
from app.schemas.session import SessionInput
from app.services.compatibility import (
    ALLOWED_DELIVERY_MODES,
    ALLOWED_WEEK_PATTERNS,
    DAY_ORDER,
    canonical_day,
    canonical_delivery_mode,
    canonical_week_pattern,
    clean_text,
    delivery_room_compatible,
    minutes_to_time,
    normalize_token,
    parse_custom_weeks,
    parse_day_list,
    positive_float,
    positive_int,
    room_capacity_fits,
    time_to_minutes,
    venue_room_compatible,
    weeks_conflict,
)
from app.services.student_group_service import student_group_code
from sqlalchemy import func
from sqlalchemy.orm import Session as DbSession


class RequirementInputValidationError(ValueError):
    def __init__(self, errors: list[dict]):
        self.errors = errors
        message = errors[0]["message"] if errors else "Invalid requirement input."
        super().__init__(message)


@dataclass(frozen=True)
class RequirementUploadRow:
    row: Mapping[str, Any]
    source_filename: str
    source_row_no: int


class RequirementInputService:
    def validate_upload_rows(
        self,
        db: DbSession,
        rows: list[RequirementUploadRow],
    ) -> tuple[list[dict], list[dict]]:
        errors: list[dict] = []
        session_data: list[dict] = []
        seen_requirement_ids: dict[str, int] = {}

        for item in rows:
            requirement_id = clean_text(self._value(item.row, "Requirement ID"))
            if requirement_id:
                # Requirement IDs are natural keys; duplicates would make edits
                # and schedule reports ambiguous, so reject them before insert.
                key = requirement_id.lower()
                if key in seen_requirement_ids:
                    issue = self._issue(
                        item.source_row_no,
                        "Requirement ID",
                        f"Duplicate requirement_id '{requirement_id}' in upload. First seen on row {seen_requirement_ids[key]}.",
                    )
                    issue["source_file"] = item.source_filename
                    errors.append(issue)
                else:
                    seen_requirement_ids[key] = item.source_row_no

            data, row_errors = self._build_session_data(
                db,
                item.row,
                item.source_filename,
                item.source_row_no,
                check_existing_duplicate=False,
                allow_reference_upsert=True,
            )
            for issue in row_errors:
                issue["source_file"] = item.source_filename
            errors.extend(row_errors)
            if not row_errors:
                session_data.append(data)

        return session_data, errors

    def data_from_input(
        self,
        db: DbSession,
        data: SessionInput,
        existing_session_id: int | None = None,
    ) -> dict:
        payload = {
            "Requirement ID": data.requirement_id,
            "Programme": data.programme,
            "Year": data.year,
            "Student Group Code": data.student_group_code,
            "Module Code": data.module_code,
            "Module Title": data.module_title,
            "Class Type": data.class_type,
            "Duration Minutes": data.duration_minutes,
            "Sessions Per Week": data.sessions_per_week,
            "Delivery Mode": data.delivery_mode,
            "Venue Type Required": data.venue_type_required,
            "Campus Mode": data.campus_mode,
            "Exact Class Size": data.exact_class_size,
            "Staff 1 Name": data.staff_name,
            "Staff 1 ID": data.staff_id,
            "Start Week": data.start_week,
            "End Week": data.end_week,
            "Week Pattern": data.week_pattern,
            "Custom Weeks": data.custom_weeks,
            "Scheduling Type": data.scheduling_type,
            "Preferred Days": data.preferred_days,
            "Avoid Days": data.avoid_days,
            "Fixed Day": data.fixed_day,
            "Fixed Start Time": data.fixed_start_time,
            "Fixed End Time": data.fixed_end_time,
            "Priority": data.priority,
            "Remarks": data.remarks,
        }
        session_data, errors = self._build_session_data(
            db,
            payload,
            "Manual Entry",
            0,
            existing_session_id=existing_session_id,
            check_existing_duplicate=True,
            allow_reference_upsert=False,
        )
        if errors:
            raise RequirementInputValidationError(errors)
        return session_data

    def session_from_data(self, data: dict) -> RequirementSession:
        session = RequirementSession()
        self.apply_data(session, data)
        return session

    def apply_data(self, session: RequirementSession, data: dict) -> None:
        staff_assignments = data.pop("staff_assignments", None)
        for key, value in data.items():
            setattr(session, key, value)
        if staff_assignments is not None:
            session.staff_assignments = [
                SessionStaff(
                    staff_id=item["staff_id"],
                    staff_order=item["staff_order"],
                    is_primary=item["is_primary"],
                )
                for item in staff_assignments
            ]

    def has_feasible_room_for_session(self, db: DbSession, session: RequirementSession) -> bool:
        if session.exact_class_size is None:
            return False
        return self._has_feasible_room(
            db,
            session.delivery_mode,
            session.campus_mode,
            session.venue_type_required,
            session.exact_class_size,
        )

    def _build_session_data(
        self,
        db: DbSession,
        row: Mapping[str, Any],
        source_filename: str,
        source_row_no: int,
        existing_session_id: int | None = None,
        check_existing_duplicate: bool = True,
        allow_reference_upsert: bool = False,
    ) -> tuple[dict, list[dict]]:
        errors: list[dict] = []

        requirement_id = self._required_text(row, source_row_no, "Requirement ID", errors)
        programme = self._lookup_programme(
            db,
            self._required_text(row, source_row_no, "Programme", errors),
            source_row_no,
            errors,
        )
        module = self._lookup_or_create_module(
            db,
            self._required_text(row, source_row_no, "Module Code", errors),
            clean_text(self._value(row, "Module Title")),
            source_row_no,
            errors,
            allow_reference_upsert,
        )
        year = self._positive_int(self._value(row, "Year"))
        exact_class_size = self._required_positive_int(row, source_row_no, "Exact Class Size", errors)
        group = self._lookup_or_create_group(
            db,
            clean_text(self._value(row, "Student Group Code")),
            programme,
            year,
            exact_class_size,
            requirement_id,
            source_row_no,
            errors,
            allow_reference_upsert,
        )
        staff_assignments = self._staff_assignments(db, row, source_row_no, errors)
        staff = staff_assignments[0]["staff"] if staff_assignments else None

        if requirement_id and check_existing_duplicate:
            self._check_existing_requirement_id(db, requirement_id, source_row_no, errors, existing_session_id)

        if programme and group and group.programme and group.programme.code.lower() != programme.code.lower():
            errors.append(
                self._issue(
                    source_row_no,
                    "Student Group Code",
                    f"Student group '{group.group_code}' belongs to programme '{group.programme.code}', not '{programme.code}'.",
                )
            )

        if year and group and group.year and int(group.year) != int(year):
            errors.append(
                self._issue(
                    source_row_no,
                    "Year",
                    f"Student group '{group.group_code}' is year {group.year}, not year {year}.",
                )
            )

        class_type = self._required_text(row, source_row_no, "Class Type", errors)
        delivery_mode = self._delivery_mode(row, source_row_no, errors)
        campus_mode = self._campus_mode(row, source_row_no, errors, delivery_mode)
        venue_type = self._required_text(row, source_row_no, "Venue Type Required", errors)
        duration = self._duration_minutes(row)
        if duration is None:
            errors.append(self._issue(source_row_no, "Duration", "Duration must be numeric and greater than 0."))
        sessions_per_week = self._required_positive_int(row, source_row_no, "Sessions Per Week", errors)
        start_week = self._required_positive_int(row, source_row_no, "Start Week", errors)
        end_week = self._required_positive_int(row, source_row_no, "End Week", errors)
        if start_week and end_week and start_week > end_week:
            errors.append(self._issue(source_row_no, "Start Week", "Start Week must be less than or equal to End Week."))

        week_pattern = self._week_pattern(row, source_row_no, errors)
        custom_weeks = clean_text(self._value(row, "Custom Weeks"))
        if week_pattern == "Custom" and not parse_custom_weeks(custom_weeks):
            errors.append(self._issue(source_row_no, "Custom Weeks", "Custom week pattern requires at least one week number."))

        scheduling_type = self._scheduling_type(row, source_row_no, errors)
        fixed_day = self._fixed_day(row, source_row_no, errors, required=scheduling_type == "Fixed")
        fixed_start, fixed_end = self._fixed_times(row, source_row_no, errors, required=scheduling_type == "Fixed")
        if scheduling_type == "Fixed" and fixed_day and fixed_start and fixed_end and week_pattern:
            self._check_fixed_time_slot(db, fixed_day, fixed_start, fixed_end, week_pattern, source_row_no, errors)

        preferred_days = self._validated_day_list(row, "Preferred Days", source_row_no, errors)
        avoid_days = self._validated_day_list(row, "Avoid Days", source_row_no, errors)

        if delivery_mode and campus_mode:
            delivery_token = normalize_token(delivery_mode)
            campus_token = normalize_token(campus_mode)
            if delivery_token in {"online", "asynchronous", "async"} and campus_token not in {"online", "virtual", "remote"}:
                errors.append(self._issue(source_row_no, "Campus Mode", "Online sessions must use online or virtual campus mode."))
            if delivery_token in {"face to face", "f2f", "physical", "in person"} and campus_token in {"online", "virtual", "remote"}:
                errors.append(self._issue(source_row_no, "Campus Mode", "Face-to-face sessions cannot use virtual campus mode."))
            if delivery_token in {"online", "asynchronous", "async"}:
                self._ensure_virtual_room(db)

        if delivery_mode and campus_mode and venue_type and exact_class_size:
            if not self._has_feasible_room(db, delivery_mode, campus_mode, venue_type, exact_class_size):
                errors.append(
                    self._issue(
                        source_row_no,
                        "Venue Type Required",
                        "No room in the database matches this venue type, campus mode, delivery mode, and class size.",
                    )
                )

        source_file = clean_text(self._value(row, "Source File")) or source_filename
        raw_source_row = self._positive_int(self._value(row, "Source Row No"))
        source_row = raw_source_row if raw_source_row and raw_source_row >= 2 else source_row_no

        data = {
            "requirement_id": requirement_id,
            "programme_id": programme.id if programme else None,
            "module_id": module.id if module else None,
            "student_group_id": group.id if group else None,
            "staff_id": staff.id if staff else None,
            "staff_assignments": [
                {
                    "staff_id": item["staff"].id,
                    "staff_order": item["staff_order"],
                    "is_primary": item["is_primary"],
                }
                for item in staff_assignments
            ],
            "class_type": class_type,
            "delivery_mode": delivery_mode,
            "campus_mode": campus_mode,
            "venue_type_required": venue_type,
            "duration_minutes": duration,
            "sessions_per_week": sessions_per_week,
            "exact_class_size": exact_class_size,
            "start_week": start_week,
            "end_week": end_week,
            "week_pattern": week_pattern,
            "custom_weeks": custom_weeks,
            "scheduling_type": scheduling_type,
            "fixed_day": fixed_day,
            "fixed_date": clean_text(self._value(row, "Fixed Date")),
            "fixed_start_time": fixed_start,
            "fixed_end_time": fixed_end,
            "preferred_days": preferred_days,
            "avoid_days": avoid_days,
            "priority": clean_text(self._value(row, "Priority")) or "Normal",
            "common_module_flag": self._to_bool(self._value(row, "Common Module?")),
            "shared_session_group_id": clean_text(self._value(row, "Shared Session Group ID")),
            "combined_with_programmes": clean_text(self._value(row, "Combined With Programmes")),
            "hard_constraint_notes": clean_text(self._value(row, "Hard Constraint Notes")),
            "soft_preference_notes": clean_text(self._value(row, "Soft Preference Notes")),
            "remarks": clean_text(self._value(row, "Remarks")),
            "source_file": source_file,
            "source_row_no": source_row,
        }
        return data, errors

    def _ensure_virtual_room(self, db: DbSession) -> None:
        if db.query(Room).filter(Room.is_virtual.is_(True)).first():
            return
        db.add(
            Room(
                room_code="VIRTUAL-ONLINE",
                room_name="Virtual Online Room",
                room_type="virtual",
                capacity=9999,
                is_virtual=True,
                campus_mode="Virtual",
                recording_available=True,
            )
        )
        db.flush()

    def _lookup_programme(
        self,
        db: DbSession,
        raw_value: str | None,
        source_row_no: int,
        errors: list[dict],
    ) -> Programme | None:
        code = self._programme_code(raw_value)
        if not code:
            return None
        programme = db.query(Programme).filter(func.lower(Programme.code) == code.lower()).first()
        if not programme:
            errors.append(self._issue(source_row_no, "Programme", f"Programme '{code}' does not exist in Database > Programmes."))
        return programme

    def _lookup_or_create_module(
        self,
        db: DbSession,
        module_code: str | None,
        module_title: str | None,
        source_row_no: int,
        errors: list[dict],
        allow_reference_upsert: bool,
    ) -> Module | None:
        if not module_code:
            return None
        module = db.query(Module).filter(func.lower(Module.module_code) == module_code.lower()).first()
        if not module:
            if not allow_reference_upsert:
                errors.append(self._issue(source_row_no, "Module Code", f"Module '{module_code}' does not exist in Database > Modules."))
                return None
            module = Module(
                module_code=module_code,
                module_title=module_title or module_code,
                term=None,
            )
            db.add(module)
            db.flush()
        return module

    def _lookup_or_create_group(
        self,
        db: DbSession,
        group_code: str | None,
        programme: Programme | None,
        year: int | None,
        class_size: int | None,
        requirement_id: str | None,
        source_row_no: int,
        errors: list[dict],
        allow_reference_upsert: bool,
    ) -> StudentGroup | None:
        if not programme or not year or not class_size:
            return None
        group_code = group_code or self._generated_group_code(programme.code, year, class_size, requirement_id)
        group = db.query(StudentGroup).filter(func.lower(StudentGroup.group_code) == group_code.lower()).first()
        if not group:
            if not allow_reference_upsert:
                errors.append(
                    self._issue(
                        source_row_no, "Student Group Code", f"Student group '{group_code}' does not exist in Database > Student Groups."
                    )
                )
                return None
            group = StudentGroup(
                group_code=group_code,
                programme_id=programme.id,
                year=year,
                size=class_size,
            )
            db.add(group)
            db.flush()
        return group

    def _generated_group_code(self, programme_code: str, year: int, class_size: int, requirement_id: str | None) -> str:
        return student_group_code(programme_code, year, 1)

    def _staff_assignments(
        self,
        db: DbSession,
        row: Mapping[str, Any],
        source_row_no: int,
        errors: list[dict],
    ) -> list[dict]:
        assignments: list[dict] = []
        seen_staff_ids: dict[int, int] = {}
        for staff_order in range(1, 5):
            id_field = f"Staff {staff_order} ID"
            name_field = f"Staff {staff_order} Name"
            staff_id = clean_text(self._value(row, id_field))
            staff_name = clean_text(self._value(row, name_field))
            if staff_order == 1 and not staff_id:
                errors.append(self._issue(source_row_no, id_field, "Staff 1 ID is required."))
                continue
            if staff_order > 1 and staff_name and not staff_id:
                errors.append(self._issue(source_row_no, id_field, f"{id_field} is required when {name_field} is filled."))
                continue
            if not staff_id:
                continue
            staff = self._lookup_staff_by_id(db, staff_id, source_row_no, id_field, errors)
            if not staff:
                continue
            if staff.id in seen_staff_ids:
                errors.append(
                    self._issue(
                        source_row_no,
                        id_field,
                        f"Duplicate staff ID '{staff_id}' also appears in Staff {seen_staff_ids[staff.id]} ID.",
                    )
                )
                continue
            seen_staff_ids[staff.id] = staff_order
            assignments.append({"staff": staff, "staff_order": staff_order, "is_primary": staff_order == 1})
        return assignments

    def _lookup_staff_by_id(
        self,
        db: DbSession,
        staff_id: str,
        source_row_no: int,
        field: str,
        errors: list[dict],
    ) -> Staff | None:
        staff = db.query(Staff).filter(func.lower(Staff.staff_id) == staff_id.lower()).first()
        if not staff:
            errors.append(self._issue(source_row_no, field, f"Staff ID '{staff_id}' does not exist in Database > Staff."))
            return None
        return staff

    def _lookup_staff(
        self,
        db: DbSession,
        staff_id: str | None,
        staff_name: str | None,
        source_row_no: int,
        errors: list[dict],
    ) -> Staff | None:
        if not staff_id and not staff_name:
            errors.append(self._issue(source_row_no, "Staff", "Either Staff 1 ID or Staff 1 Name is required."))
            return None

        staff = None
        if staff_id:
            staff = db.query(Staff).filter(func.lower(Staff.staff_id) == staff_id.lower()).first()
            if not staff:
                errors.append(self._issue(source_row_no, "Staff 1 ID", f"Staff ID '{staff_id}' does not exist in Database > Staff."))
                return None

        if not staff and staff_name:
            staff = db.query(Staff).filter(func.lower(Staff.staff_name) == staff_name.lower()).first()
            if not staff:
                errors.append(
                    self._issue(source_row_no, "Staff 1 Name", f"Staff name '{staff_name}' does not exactly match Database > Staff.")
                )
                return None

        if staff and staff_name and staff.staff_name and staff.staff_name.lower() != staff_name.lower():
            return staff
        return staff

    def _check_existing_requirement_id(
        self,
        db: DbSession,
        requirement_id: str,
        source_row_no: int,
        errors: list[dict],
        existing_session_id: int | None,
    ) -> None:
        query = db.query(RequirementSession).filter(func.lower(RequirementSession.requirement_id) == requirement_id.lower())
        if existing_session_id is not None:
            query = query.filter(RequirementSession.id != existing_session_id)
        if query.first():
            errors.append(self._issue(source_row_no, "Requirement ID", f"Requirement ID '{requirement_id}' already exists."))

    def _check_fixed_time_slot(
        self,
        db: DbSession,
        fixed_day: str,
        fixed_start: str,
        fixed_end: str,
        week_pattern: str,
        source_row_no: int,
        errors: list[dict],
    ) -> None:
        matches = (
            db.query(TimeSlot)
            .filter(
                TimeSlot.day == fixed_day,
                TimeSlot.start_time == fixed_start,
                TimeSlot.end_time == fixed_end,
            )
            .all()
        )
        if not any(weeks_conflict(slot.week_pattern, week_pattern) for slot in matches):
            errors.append(
                self._issue(
                    source_row_no,
                    "Fixed Start Time",
                    "No time slot matches the fixed day, start time, end time, and week pattern.",
                )
            )

    def _has_feasible_room(
        self,
        db: DbSession,
        delivery_mode: str | None,
        campus_mode: str | None,
        venue_type: str | None,
        exact_class_size: int,
    ) -> bool:
        # Use the same compatibility helpers as the solver so validation and
        # generation agree on what counts as a usable room.
        probe = SimpleNamespace(
            delivery_mode=delivery_mode,
            campus_mode=campus_mode,
            venue_type_required=venue_type,
            exact_class_size=exact_class_size,
        )
        for room in db.query(Room).all():
            if not self._campus_room_compatible(campus_mode, room):
                continue
            if delivery_room_compatible(probe, room) and venue_room_compatible(probe, room) and room_capacity_fits(probe, room):
                return True
        return False

    def _campus_room_compatible(self, campus_mode: str | None, room: Room) -> bool:
        campus = normalize_token(campus_mode)
        room_campus = normalize_token(room.campus_mode)
        if campus in {"online", "virtual", "remote"}:
            return bool(room.is_virtual) or room_campus in {"online", "virtual", "remote"}
        if campus in {"physical", "campus", "on campus", "in campus", "face to face", "in person"}:
            return not bool(room.is_virtual) and room_campus not in {"online", "virtual", "remote"}
        if campus == "external":
            return room_campus == "external"
        return True

    def _delivery_mode(self, row: Mapping[str, Any], source_row_no: int, errors: list[dict]) -> str | None:
        raw = self._required_text(row, source_row_no, "Delivery Mode", errors)
        if not raw:
            return None
        if normalize_token(raw) not in ALLOWED_DELIVERY_MODES:
            errors.append(
                self._issue(source_row_no, "Delivery Mode", "Delivery Mode must be Face-to-face, Online, Hybrid, or Asynchronous.")
            )
            return canonical_delivery_mode(raw)
        return canonical_delivery_mode(raw)

    def _campus_mode(
        self,
        row: Mapping[str, Any],
        source_row_no: int,
        errors: list[dict],
        delivery_mode: str | None,
    ) -> str | None:
        raw = clean_text(self._value(row, "Campus Mode"))
        if not raw:
            return self._derived_campus_mode(delivery_mode)
        token = normalize_token(raw)
        if token in {"physical", "campus", "on campus", "in campus", "face to face", "in person"}:
            return "Physical"
        if token in {"online", "virtual", "remote"}:
            return "Virtual"
        if token == "external":
            return "External"
        errors.append(self._issue(source_row_no, "Campus Mode", "Campus Mode must be Physical, Virtual, Online, Remote, or External."))
        return raw

    def _derived_campus_mode(self, delivery_mode: str | None) -> str | None:
        token = normalize_token(delivery_mode)
        if token in {"online", "asynchronous", "async"}:
            return "Virtual"
        if token:
            return "Physical"
        return None

    def _week_pattern(self, row: Mapping[str, Any], source_row_no: int, errors: list[dict]) -> str | None:
        raw = self._required_text(row, source_row_no, "Week Pattern", errors)
        if not raw:
            return None
        if normalize_token(raw) not in ALLOWED_WEEK_PATTERNS:
            errors.append(self._issue(source_row_no, "Week Pattern", "Week Pattern must be Weekly, Odd, Even, or Custom."))
        return canonical_week_pattern(raw)

    def _scheduling_type(self, row: Mapping[str, Any], source_row_no: int, errors: list[dict]) -> str | None:
        raw = self._required_text(row, source_row_no, "Scheduling Type", errors)
        if not raw:
            return None
        token = normalize_token(raw)
        if token == "fixed":
            return "Fixed"
        if token in {"flexible", "preferred", "preference"}:
            return "Flexible"
        errors.append(self._issue(source_row_no, "Scheduling Type", "Scheduling Type must be Fixed or Flexible."))
        return raw

    def _fixed_day(
        self,
        row: Mapping[str, Any],
        source_row_no: int,
        errors: list[dict],
        required: bool,
    ) -> str | None:
        raw = clean_text(self._value(row, "Fixed Day"))
        if not raw:
            if required:
                errors.append(self._issue(source_row_no, "Fixed Day", "Fixed sessions must include a fixed day."))
            return None
        day = canonical_day(raw)
        if day not in DAY_ORDER:
            errors.append(self._issue(source_row_no, "Fixed Day", "Fixed Day must be Monday, Tuesday, Wednesday, Thursday, or Friday."))
        return day

    def _fixed_times(
        self,
        row: Mapping[str, Any],
        source_row_no: int,
        errors: list[dict],
        required: bool,
    ) -> tuple[str | None, str | None]:
        start_raw = self._value(row, "Fixed Start Time")
        end_raw = self._value(row, "Fixed End Time")
        start = time_to_minutes(start_raw)
        end = time_to_minutes(end_raw)
        if start is None and required:
            errors.append(self._issue(source_row_no, "Fixed Start Time", "Fixed sessions must include a fixed start time."))
        if end is None and required:
            errors.append(self._issue(source_row_no, "Fixed End Time", "Fixed sessions must include a fixed end time."))
        if start is not None and end is not None and end <= start:
            errors.append(self._issue(source_row_no, "Fixed End Time", "Fixed End Time must be after Fixed Start Time."))
        return (
            minutes_to_time(start) if start is not None else None,
            minutes_to_time(end) if end is not None else None,
        )

    def _validated_day_list(
        self,
        row: Mapping[str, Any],
        field: str,
        source_row_no: int,
        errors: list[dict],
    ) -> str | None:
        raw = clean_text(self._value(row, field))
        if not raw:
            return None
        days = parse_day_list(raw)
        invalid_days = [day for day in days if day not in DAY_ORDER]
        if invalid_days:
            errors.append(self._issue(source_row_no, field, f"{field} contains invalid day values: {', '.join(invalid_days)}."))
        return raw

    def _duration_minutes(self, row: Mapping[str, Any]) -> int | None:
        fixed_start = time_to_minutes(self._value(row, "Fixed Start Time"))
        fixed_end = time_to_minutes(self._value(row, "Fixed End Time"))
        if fixed_start is not None and fixed_end is not None and fixed_end > fixed_start:
            return fixed_end - fixed_start

        minutes = self._positive_int(self._value(row, "Duration Minutes"))
        if minutes:
            return minutes

        hours = self._positive_float(self._value(row, "Duration Hours"))
        if hours is not None:
            return int(hours * 60)

        raw_duration = self._positive_float(self._value(row, "Duration Raw"))
        if raw_duration is not None:
            return int(raw_duration * 20)
        return None

    def _required_text(
        self,
        row: Mapping[str, Any],
        source_row_no: int,
        field: str,
        errors: list[dict],
    ) -> str | None:
        value = clean_text(self._value(row, field))
        if not value:
            errors.append(self._issue(source_row_no, field, f"{field} is required."))
        return value

    def _required_positive_int(
        self,
        row: Mapping[str, Any],
        source_row_no: int,
        field: str,
        errors: list[dict],
    ) -> int | None:
        value = self._positive_int(self._value(row, field))
        if value is None:
            errors.append(self._issue(source_row_no, field, f"{field} must be numeric and greater than 0."))
        return value

    def _positive_int(self, value: Any) -> int | None:
        return positive_int(value)

    def _positive_float(self, value: Any) -> float | None:
        return positive_float(value)

    def _programme_code(self, value: str | None) -> str | None:
        text = clean_text(value)
        if not text:
            return None
        return text.replace("-", " ").split()[0].upper()

    def _value(self, row: Mapping[str, Any], key: str) -> Any:
        if key in row:
            return row[key]
        snake_key = key.lower().replace("?", "").replace("/", "_").replace(" ", "_").replace("-", "_")
        if snake_key in row:
            return row[snake_key]
        return None

    def _to_bool(self, value: Any) -> bool:
        text = (clean_text(value) or "").lower()
        return text in {"yes", "y", "true", "1", "common"}

    def _issue(self, row: int, field: str, message: str) -> dict:
        return {"row": row, "field": field, "message": message}
