"""Generic CRUD and Excel sync service for Database tab reference data.

Each configured data type describes its model, visible columns, natural key, and
serializer so the routes can share one implementation across split DB tables.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from io import BytesIO
from typing import Any

import pandas as pd
from app.models.module import Module
from app.models.programme import Programme
from app.models.room import Room
from app.models.session import Session
from app.models.session_staff import SessionStaff
from app.models.staff import Staff
from app.models.student_group import StudentGroup
from app.models.time_slot import TimeSlot
from app.services.compatibility import (
    canonical_day,
    canonical_delivery_mode,
    canonical_week_pattern,
    clean_text,
    minutes_to_time,
    time_to_minutes,
)
from app.services.schedule_state_service import clear_schedule_state
from app.services.serializers import (
    group_to_dict,
    module_to_dict,
    programme_to_dict,
    room_to_dict,
    session_to_dict,
    staff_to_dict,
    time_slot_to_dict,
)
from sqlalchemy import func
from sqlalchemy.orm import Session as DbSession


class DatabaseValidationError(ValueError):
    def __init__(self, errors: list[dict]):
        self.errors = errors
        message = errors[0]["message"] if errors else "Invalid database data"
        super().__init__(message)


@dataclass(frozen=True)
class ColumnSpec:
    key: str
    label: str
    kind: str = "text"
    required: bool = False
    read_only: bool = False
    aliases: tuple[str, ...] = ()


@dataclass(frozen=True)
class DatabaseTypeConfig:
    id: str
    label: str
    model: type
    columns: tuple[ColumnSpec, ...]
    key_fields: tuple[str, ...]
    serializer: Callable[[Any], dict]
    sort_fields: tuple[str, ...]


DATABASE_TYPES: dict[str, DatabaseTypeConfig] = {
    "rooms": DatabaseTypeConfig(
        id="rooms",
        label="Rooms",
        model=Room,
        columns=(
            ColumnSpec("id", "ID", "number", read_only=True),
            ColumnSpec("room_code", "Address", required=True, aliases=("Location Name",)),
            ColumnSpec("room_name", "Room Code", required=True, aliases=("Location Description",)),
            ColumnSpec("room_type", "Room Type", required=True, aliases=("Resource Type",)),
            ColumnSpec("capacity", "Capacity", "number", required=True),
            ColumnSpec("is_virtual", "Virtual", "boolean"),
            ColumnSpec("campus_mode", "Campus Mode"),
            ColumnSpec("recording_available", "Recording", "boolean", required=True, aliases=("Recording Available",)),
        ),
        key_fields=("room_code",),
        serializer=room_to_dict,
        sort_fields=("room_code",),
    ),
    "staff": DatabaseTypeConfig(
        id="staff",
        label="Staff",
        model=Staff,
        columns=(
            ColumnSpec("id", "ID", "number", read_only=True),
            ColumnSpec("staff_id", "Staff ID", required=True, aliases=("Host Key",)),
            ColumnSpec("staff_name", "Staff Name", required=True, aliases=("Name",)),
        ),
        key_fields=("staff_id",),
        serializer=staff_to_dict,
        sort_fields=("staff_name", "staff_id"),
    ),
    "programmes": DatabaseTypeConfig(
        id="programmes",
        label="Programmes",
        model=Programme,
        columns=(
            ColumnSpec("id", "ID", "number", read_only=True),
            ColumnSpec("code", "Code", required=True),
            ColumnSpec("name", "Name", required=True),
            ColumnSpec("years", "Years", "number", aliases=("Duration", "Duration Years")),
        ),
        key_fields=("code",),
        serializer=programme_to_dict,
        sort_fields=("code",),
    ),
    "modules": DatabaseTypeConfig(
        id="modules",
        label="Modules",
        model=Module,
        columns=(
            ColumnSpec("id", "ID", "number", read_only=True),
            ColumnSpec("module_code", "Module Code", required=True),
            ColumnSpec("module_host_key", "Host Key"),
            ColumnSpec("module_title", "Module Title"),
            ColumnSpec("term", "Term"),
        ),
        key_fields=("module_code",),
        serializer=module_to_dict,
        sort_fields=("module_code",),
    ),
    "student-groups": DatabaseTypeConfig(
        id="student-groups",
        label="Student Groups",
        model=StudentGroup,
        columns=(
            ColumnSpec("id", "ID", "number", read_only=True),
            ColumnSpec("group_code", "Group Code", required=True),
            ColumnSpec("programme", "Programme"),
            ColumnSpec("year", "Year", "number"),
            ColumnSpec("size", "Size", "number"),
        ),
        key_fields=("group_code",),
        serializer=group_to_dict,
        sort_fields=("group_code",),
    ),
    "time-slots": DatabaseTypeConfig(
        id="time-slots",
        label="Time Slots",
        model=TimeSlot,
        columns=(
            ColumnSpec("id", "ID", "number", read_only=True),
            ColumnSpec("day", "Day", required=True),
            ColumnSpec("start_time", "Start Time", "time", required=True),
            ColumnSpec("end_time", "End Time", "time", required=True),
            ColumnSpec("duration_minutes", "Duration", "number", required=True),
            ColumnSpec("week_pattern", "Week Pattern", required=True),
        ),
        key_fields=("day", "start_time", "end_time", "week_pattern"),
        serializer=time_slot_to_dict,
        sort_fields=("day", "start_time", "week_pattern"),
    ),
    "requirements": DatabaseTypeConfig(
        id="requirements",
        label="Requirements",
        model=Session,
        columns=(
            ColumnSpec("id", "ID", "number", read_only=True),
            ColumnSpec("requirement_id", "Requirement ID", required=True),
            ColumnSpec("programme", "Programme", required=True),
            ColumnSpec("module_code", "Module Code", required=True),
            ColumnSpec("student_group_code", "Student Group", required=True),
            ColumnSpec("staff_id", "Staff ID"),
            ColumnSpec("staff_name", "Staff Name"),
            ColumnSpec("class_type", "Class Type", required=True),
            ColumnSpec("delivery_mode", "Delivery Mode", required=True),
            ColumnSpec("campus_mode", "Campus Mode", required=True),
            ColumnSpec("venue_type_required", "Venue Type", required=True),
            ColumnSpec("duration_minutes", "Duration", "number", required=True),
            ColumnSpec("sessions_per_week", "Sessions/Week", "number", required=True),
            ColumnSpec("exact_class_size", "Class Size", "number", required=True),
            ColumnSpec("start_week", "Start Week", "number", required=True),
            ColumnSpec("end_week", "End Week", "number", required=True),
            ColumnSpec("week_pattern", "Week Pattern", required=True),
            ColumnSpec("custom_weeks", "Custom Weeks"),
            ColumnSpec("scheduling_type", "Scheduling Type", required=True),
            ColumnSpec("fixed_day", "Fixed Day"),
            ColumnSpec("fixed_start_time", "Fixed Start", "time"),
            ColumnSpec("fixed_end_time", "Fixed End", "time"),
            ColumnSpec("preferred_days", "Preferred Days"),
            ColumnSpec("avoid_days", "Avoid Days"),
            ColumnSpec("priority", "Priority"),
            ColumnSpec("remarks", "Remarks"),
            ColumnSpec("source_file", "Source File"),
            ColumnSpec("source_row_no", "Source Row", "number"),
        ),
        key_fields=("requirement_id",),
        serializer=session_to_dict,
        sort_fields=("requirement_id",),
    ),
}

ADMIN_DATABASE_TYPE_IDS = ("rooms", "staff", "programmes", "modules")


class DatabaseService:
    def types(self) -> list[dict]:
        return [
            {
                "id": config.id,
                "label": config.label,
                "columns": [
                    {
                        "key": column.key,
                        "label": column.label,
                        "kind": column.kind,
                        "required": column.required,
                        "read_only": column.read_only,
                    }
                    for column in config.columns
                ],
            }
            for config in (DATABASE_TYPES[data_type] for data_type in ADMIN_DATABASE_TYPE_IDS)
        ]

    def list_rows(self, db: DbSession, data_type: str) -> list[dict]:
        config = self._config(data_type)
        query = db.query(config.model)
        for field in config.sort_fields:
            query = query.order_by(getattr(config.model, field))
        return [config.serializer(item) for item in query.all()]

    def create_row(self, db: DbSession, data_type: str, payload: dict) -> dict:
        config = self._config(data_type)
        self._clear_schedule_state(db)
        item = self._build_model(db, config, payload)
        self._ensure_unique_key(db, config, item)
        db.add(item)
        db.commit()
        db.refresh(item)
        return config.serializer(item)

    def update_row(self, db: DbSession, data_type: str, row_id: int, payload: dict) -> dict:
        config = self._config(data_type)
        item = db.query(config.model).filter_by(id=row_id).first()
        if not item:
            raise KeyError(f"{config.label} row not found")

        data = config.serializer(item)
        data.update(payload)
        updated = self._coerce_payload(db, config, data)
        self._apply_model_data(item, updated)
        self._ensure_unique_key(db, config, item, row_id=row_id)
        self._clear_schedule_state(db)
        db.commit()
        db.refresh(item)
        return config.serializer(item)

    def delete_row(self, db: DbSession, data_type: str, row_id: int) -> dict:
        config = self._config(data_type)
        item = db.query(config.model).filter_by(id=row_id).first()
        if not item:
            raise KeyError(f"{config.label} row not found")
        self._assert_can_remove(db, config, [item])
        self._clear_schedule_state(db)
        db.delete(item)
        db.commit()
        return {"message": f"{config.label} row deleted"}

    def replace_from_excel(self, db: DbSession, data_type: str, workbook_bytes: bytes) -> dict:
        config = self._config(data_type)
        frame = self._read_excel(config, workbook_bytes)
        rows_read = int(len(frame.index))
        errors = self._validate_columns(config, frame)
        if errors:
            raise DatabaseValidationError(errors)

        payloads = []
        for index, row in frame.iterrows():
            try:
                payloads.append(self._row_to_payload(db, config, row))
            except ValueError as exc:
                errors.append({"row": int(index) + 2, "field": "Row", "message": str(exc)})
        payloads = self._sorted_payloads(config, payloads)
        errors.extend(self._duplicate_key_errors(config, payloads))
        if errors:
            raise DatabaseValidationError(errors)

        self._clear_schedule_state(db)
        self._replace_rows(db, config, payloads)
        db.commit()
        return {"rows_read": rows_read, "rows_imported": len(payloads), "rows_failed": 0, "errors": []}

    def example_workbook(self, db: DbSession, data_type: str) -> BytesIO:
        config = self._config(data_type)
        rows = self.list_rows(db, data_type)
        columns = [column.key for column in config.columns if not column.read_only]
        frame = pd.DataFrame([{column: row.get(column) for column in columns} for row in rows], columns=columns)
        buffer = BytesIO()
        with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
            frame.to_excel(writer, index=False, sheet_name=config.label[:31])
        buffer.seek(0)
        return buffer

    def _config(self, data_type: str) -> DatabaseTypeConfig:
        try:
            return DATABASE_TYPES[data_type]
        except KeyError as exc:
            raise KeyError(f"Unknown database type: {data_type}") from exc

    def _read_excel(self, config: DatabaseTypeConfig, workbook_bytes: bytes) -> pd.DataFrame:
        with pd.ExcelFile(BytesIO(workbook_bytes)) as xls:
            sheet_name = self._matching_sheet_name(config, xls)
            frame = pd.read_excel(xls, sheet_name=sheet_name)
        return frame.dropna(how="all")

    def _matching_sheet_name(self, config: DatabaseTypeConfig, xls: pd.ExcelFile) -> str:
        expected = self._expected_column_names(config)
        best_sheet = xls.sheet_names[0]
        best_score = -1
        for sheet_name in xls.sheet_names:
            headers = pd.read_excel(xls, sheet_name=sheet_name, nrows=0).columns
            actual = {str(column).strip().lower() for column in headers}
            score = len(expected & actual)
            if score > best_score:
                best_sheet = sheet_name
                best_score = score
        return best_sheet

    def _validate_columns(self, config: DatabaseTypeConfig, frame: pd.DataFrame) -> list[dict]:
        actual = {str(column).strip().lower(): column for column in frame.columns}
        errors = []
        for column in (column for column in config.columns if not column.read_only):
            names = self._column_names(column)
            if not any(name.lower() in actual for name in names):
                errors.append({"row": 1, "field": column.key, "message": f"Missing required column '{column.key}'."})
        return errors

    def _row_to_payload(self, db: DbSession, config: DatabaseTypeConfig, row) -> dict:
        payload = {}
        lookup = {str(column).strip().lower(): column for column in row.index}
        for column in config.columns:
            if column.read_only:
                continue
            source = next((lookup.get(name.lower()) for name in self._column_names(column) if name.lower() in lookup), None)
            payload[column.key] = row.get(source) if source is not None else None
        return self._coerce_payload(db, config, payload)

    def _expected_column_names(self, config: DatabaseTypeConfig) -> set[str]:
        names = set()
        for column in config.columns:
            if not column.read_only:
                names.update(name.lower() for name in self._column_names(column))
        return names

    def _column_names(self, column: ColumnSpec) -> tuple[str, ...]:
        return (column.key, column.label, *column.aliases)

    def _coerce_payload(self, db: DbSession, config: DatabaseTypeConfig, payload: dict) -> dict:
        data = {}
        for column in config.columns:
            if column.read_only:
                continue
            raw = payload.get(column.key)
            value = self._coerce_value(column, raw)
            if column.required and value is None:
                raise ValueError(f"{column.label} is required.")
            data[column.key] = value

        if config.id == "student-groups":
            programme_code = clean_text(data.pop("programme", None))
            programme = self._lookup_programme(db, programme_code) if programme_code else None
            data["programme_id"] = programme.id if programme else None
        elif config.id == "requirements":
            data = self._coerce_requirement(db, data)
        elif config.id == "time-slots":
            data["day"] = canonical_day(data.get("day"))
            data["week_pattern"] = canonical_week_pattern(data.get("week_pattern")) or "Weekly"
            if data.get("start_time") and data.get("end_time"):
                start = time_to_minutes(data["start_time"])
                end = time_to_minutes(data["end_time"])
                if start is None or end is None or end <= start:
                    raise ValueError("End time must be after start time.")
                data["duration_minutes"] = data.get("duration_minutes") or end - start
        elif config.id == "rooms":
            room_address, room_name = self._split_room_location(data.get("room_code"))
            data["room_code"] = room_address
            data["room_name"] = room_name if room_name != room_address else data.get("room_name")
            is_virtual = "virtual" in (data.get("room_type") or "").lower()
            data["is_virtual"] = data.get("is_virtual") if data.get("is_virtual") is not None else is_virtual
            data["campus_mode"] = data.get("campus_mode") or ("Virtual" if data["is_virtual"] else "Physical")
        elif config.id == "staff":
            if data.get("staff_name"):
                data["staff_name"] = re.sub(r"\s+\.$", "", data["staff_name"]).strip()
            data["staff_host_key"] = data.get("staff_host_key") or data.get("staff_id")
        elif config.id == "modules":
            data["module_title"] = data.get("module_title") or data.get("module_code")
        return data

    def _split_room_location(self, room_code: str | None) -> tuple[str | None, str | None]:
        text = clean_text(room_code)
        if not text:
            return None, None
        match = re.match(r"^([A-Za-z0-9]+-[A-Za-z0-9]+-\d{2})-(.+)$", text)
        if not match:
            return text, text
        return match.group(1), match.group(2).strip()

    def _coerce_requirement(self, db: DbSession, data: dict) -> dict:
        programme = self._lookup_programme(db, clean_text(data.pop("programme", None)))
        module = self._lookup_module(db, clean_text(data.pop("module_code", None)))
        group = self._lookup_group(db, clean_text(data.pop("student_group_code", None)))
        staff = self._lookup_staff(db, clean_text(data.pop("staff_id", None)), clean_text(data.pop("staff_name", None)))
        if not staff:
            raise ValueError("Either Staff ID or Staff Name must match an existing staff record.")
        data["programme_id"] = programme.id
        data["module_id"] = module.id
        data["student_group_id"] = group.id
        data["staff_id"] = staff.id
        data["delivery_mode"] = canonical_delivery_mode(data.get("delivery_mode"))
        data["week_pattern"] = canonical_week_pattern(data.get("week_pattern")) or "Weekly"
        data["fixed_day"] = canonical_day(data.get("fixed_day"))
        data["source_file"] = clean_text(data.get("source_file")) or "Database Entry"
        return data

    def _coerce_value(self, column: ColumnSpec, value: object) -> Any:
        if column.kind == "boolean":
            return self._bool_value(value)
        if column.kind == "number":
            return self._int_value(value)
        if column.kind == "time":
            minutes = time_to_minutes(value)
            return minutes_to_time(minutes) if minutes is not None else None
        return clean_text(value)

    def _bool_value(self, value: object) -> bool | None:
        text = clean_text(value)
        if text is None:
            return None
        if isinstance(value, bool):
            return value
        lowered = text.lower()
        if lowered in {"true", "yes", "y", "1"}:
            return True
        if lowered in {"false", "no", "n", "0"}:
            return False
        raise ValueError(f"Expected a boolean value, got '{text}'.")

    def _int_value(self, value: object) -> int | None:
        text = clean_text(value)
        if text is None:
            return None
        try:
            number = float(text)
        except ValueError as exc:
            raise ValueError(f"Expected a number, got '{text}'.") from exc
        return int(number)

    def _build_model(self, db: DbSession, config: DatabaseTypeConfig, payload: dict):
        data = self._coerce_payload(db, config, payload)
        item = config.model()
        self._apply_model_data(item, data)
        return item

    def _apply_model_data(self, item, data: dict) -> None:
        for key, value in data.items():
            setattr(item, key, value)

    def _replace_rows(self, db: DbSession, config: DatabaseTypeConfig, payloads: list[dict]) -> None:
        existing = db.query(config.model).all()
        if existing:
            try:
                self._assert_can_remove(db, config, existing)
            except DatabaseValidationError:
                pass
            else:
                for item in existing:
                    db.delete(item)
                db.flush()
                for payload in payloads:
                    item = config.model()
                    self._apply_model_data(item, payload)
                    db.add(item)
                return

        existing_by_key = {self._key(config, config.serializer(item)): item for item in existing}
        incoming_keys = set()
        for payload in payloads:
            key = self._key(config, payload)
            incoming_keys.add(key)
            item = existing_by_key.get(key)
            if item is None:
                item = config.model()
                db.add(item)
            self._apply_model_data(item, payload)

        to_remove = [item for key, item in existing_by_key.items() if key not in incoming_keys]
        self._assert_can_remove(db, config, to_remove)
        for item in to_remove:
            db.delete(item)

    def _sorted_payloads(self, config: DatabaseTypeConfig, payloads: list[dict]) -> list[dict]:
        def sort_key(payload: dict) -> tuple:
            values = []
            for field in config.sort_fields:
                value = payload.get(field)
                if isinstance(value, str):
                    values.append(value.casefold())
                elif value is None:
                    values.append("")
                else:
                    values.append(value)
            return tuple(values)

        return sorted(payloads, key=sort_key)

    def _duplicate_key_errors(self, config: DatabaseTypeConfig, payloads: list[dict]) -> list[dict]:
        seen = set()
        errors = []
        for index, payload in enumerate(payloads, start=2):
            key = self._key(config, payload)
            if key in seen:
                errors.append({"row": index, "field": ",".join(config.key_fields), "message": "Duplicate key in upload."})
            seen.add(key)
        return errors

    def _ensure_unique_key(self, db: DbSession, config: DatabaseTypeConfig, item, row_id: int | None = None) -> None:
        filters = [getattr(config.model, field) == getattr(item, field) for field in config.key_fields]
        query = db.query(config.model).filter(*filters)
        if row_id is not None:
            query = query.filter(config.model.id != row_id)
        if query.first():
            raise DatabaseValidationError(
                [{"row": 0, "field": ",".join(config.key_fields), "message": "A row with this key already exists."}]
            )

    def _key(self, config: DatabaseTypeConfig, payload: dict) -> tuple:
        return tuple(
            (payload.get(field) or "").strip().lower() if isinstance(payload.get(field), str) else payload.get(field)
            for field in config.key_fields
        )

    def _assert_can_remove(self, db: DbSession, config: DatabaseTypeConfig, items: list) -> None:
        if not items:
            return
        ids = [item.id for item in items]
        errors = []
        if config.id == "staff" and db.query(Session).filter(Session.staff_id.in_(ids)).first():
            errors.append("Cannot remove staff used by requirements.")
        if config.id == "staff" and db.query(SessionStaff).filter(SessionStaff.staff_id.in_(ids)).first():
            errors.append("Cannot remove staff used as requirement co-teachers.")
        if config.id == "modules" and db.query(Session).filter(Session.module_id.in_(ids)).first():
            errors.append("Cannot remove modules used by requirements.")
        if config.id == "programmes":
            if db.query(Session).filter(Session.programme_id.in_(ids)).first():
                errors.append("Cannot remove programmes used by requirements.")
            if db.query(StudentGroup).filter(StudentGroup.programme_id.in_(ids)).first():
                errors.append("Cannot remove programmes used by student groups.")
        if config.id == "student-groups" and db.query(Session).filter(Session.student_group_id.in_(ids)).first():
            errors.append("Cannot remove student groups used by requirements.")
        if errors:
            raise DatabaseValidationError([{"row": 0, "field": "References", "message": " ".join(errors)}])

    def _lookup_programme(self, db: DbSession, code: str | None) -> Programme:
        if not code:
            raise ValueError("Programme must match an existing programme code.")
        programme = db.query(Programme).filter(func.lower(Programme.code) == code.lower()).first()
        if not programme:
            raise ValueError(f"Programme '{code}' does not exist.")
        return programme

    def _lookup_module(self, db: DbSession, module_code: str | None) -> Module:
        if not module_code:
            raise ValueError("Module Code must match an existing module.")
        module = db.query(Module).filter(func.lower(Module.module_code) == module_code.lower()).first()
        if not module:
            raise ValueError(f"Module '{module_code}' does not exist.")
        return module

    def _lookup_group(self, db: DbSession, group_code: str | None) -> StudentGroup:
        if not group_code:
            raise ValueError("Student Group must match an existing group.")
        group = db.query(StudentGroup).filter(func.lower(StudentGroup.group_code) == group_code.lower()).first()
        if not group:
            raise ValueError(f"Student group '{group_code}' does not exist.")
        return group

    def _lookup_staff(self, db: DbSession, staff_id: str | None, staff_name: str | None) -> Staff | None:
        staff = None
        if staff_id:
            staff = db.query(Staff).filter(func.lower(Staff.staff_id) == staff_id.lower()).first()
        if not staff and staff_name:
            staff = db.query(Staff).filter(func.lower(Staff.staff_name) == staff_name.lower()).first()
        return staff

    def _clear_schedule_state(self, db: DbSession) -> None:
        clear_schedule_state(db)
