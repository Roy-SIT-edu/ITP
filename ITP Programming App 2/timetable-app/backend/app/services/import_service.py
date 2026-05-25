from __future__ import annotations

import re
from io import BytesIO
from pathlib import Path
from typing import BinaryIO

import pandas as pd
from sqlalchemy.orm import Session as DbSession

from app.models.constraint_violation import ConstraintViolation
from app.models.module import Module
from app.models.programme import Programme
from app.models.room import Room
from app.models.schedule_run import ScheduleRun
from app.models.scheduled_session import ScheduledSession
from app.models.session import Session
from app.models.staff import Staff
from app.models.student_group import StudentGroup
from app.services.compatibility import (
    canonical_day,
    canonical_delivery_mode,
    canonical_week_pattern,
    clean_text,
    minutes_to_time,
    time_to_minutes,
)
from app.services.seed_service import seed_reference_data


CANONICAL_COLUMNS = {
    "Requirement ID": ["requirement id", "requirement_id", "req id", "req no"],
    "Programme": ["programme", "program", "programme code", "program code"],
    "Year": ["year", "student year"],
    "Student Group Code": ["student group code", "group code", "student group", "group"],
    "Module Code": ["module code", "module", "sis module code"],
    "Module Host Key": ["module host key", "module host", "host key", "activity hostkey", "hostkey"],
    "Module Title": ["module title", "title"],
    "Class Type": ["class type", "session type", "activity type"],
    "Session Count": ["session count", "number of sessions", "no of sessions"],
    "Duration Hours": ["duration hours", "duration hrs"],
    "Duration Raw": ["duration"],
    "Duration Minutes": ["duration minutes", "duration mins"],
    "Sessions Per Week": ["sessions per week", "session per week"],
    "Delivery Mode": ["delivery mode", "mode"],
    "Venue Type Required": ["venue type required", "venue required", "venue type"],
    "Campus Mode": ["campus mode", "campus"],
    "Exact Class Size": ["exact class size", "class size", "size"],
    "Staff 1 Name": ["staff 1 name", "staff name", "tutor name", "lecturer name", "staff1"],
    "Staff 1 ID": ["staff 1 id", "staff id", "tutor id", "lecturer id", "sis staff id", "staff suitability id"],
    "Staff 2 Name": ["staff 2 name", "staff2"],
    "Staff 2 ID": ["staff 2 id"],
    "Start Week": ["start week"],
    "End Week": ["end week"],
    "Week Pattern": ["week pattern", "weeks pattern"],
    "Custom Weeks": ["custom weeks", "tri week"],
    "Scheduling Type": ["scheduling type", "schedule type"],
    "Preferred Days": ["preferred days", "preferred day"],
    "Avoid Days": ["avoid days", "avoid day"],
    "Fixed Day": ["fixed day", "day"],
    "Fixed Date": ["fixed date"],
    "Fixed Start Time": ["fixed start time", "fixed start", "start"],
    "Fixed End Time": ["fixed end time", "fixed end", "end"],
    "Priority": ["priority"],
    "Common Module?": ["common module?", "common module", "common module flag"],
    "Shared Session Group ID": ["shared session group id", "shared group id"],
    "Combined With Programmes": ["combined with programmes", "combined programmes"],
    "Hard Constraint Notes": ["hard constraint notes", "hard constraints"],
    "Soft Preference Notes": ["soft preference notes", "soft preferences"],
    "Remarks": ["remarks", "notes"],
    "Source File": ["source file"],
    "Source Row No": ["source row no", "source row number"],
}


def _normalise_column_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


ALIAS_LOOKUP = {
    _normalise_column_name(alias): canonical
    for canonical, aliases in CANONICAL_COLUMNS.items()
    for alias in [canonical, *aliases]
}


class ImportService:
    def import_upload(self, db: DbSession, file: BinaryIO, filename: str) -> dict:
        data = file.read()
        return self.import_input_template_bytes(db, data, source_filename=filename)

    def import_input_template_files(
        self,
        db: DbSession,
        workbooks: list[tuple[bytes, str]],
    ) -> dict:
        frames = [
            (self._read_workbook_frame(BytesIO(workbook_bytes)), source_filename)
            for workbook_bytes, source_filename in workbooks
        ]
        return self._import_frames(db, frames)

    def import_input_template_bytes(
        self,
        db: DbSession,
        workbook_bytes: bytes,
        source_filename: str,
    ) -> dict:
        frame = self._read_workbook_frame(BytesIO(workbook_bytes))
        return self._import_frames(db, [(frame, source_filename)])

    def import_input_template(
        self,
        db: DbSession,
        workbook_path: str | Path,
        source_filename: str | None = None,
    ) -> dict:
        source_filename = source_filename or Path(workbook_path).name
        frame = self._read_workbook_frame(workbook_path)
        return self._import_frames(db, [(frame, source_filename)])

    def _read_workbook_frame(self, workbook_source) -> pd.DataFrame:
        with pd.ExcelFile(workbook_source) as xls:
            sheet_name = self._choose_sheet(xls.sheet_names)
            frame = pd.read_excel(xls, sheet_name=sheet_name)
        frame = frame.dropna(how="all")
        return self._prepare_frame(frame)

    def _import_frames(self, db: DbSession, frames: list[tuple[pd.DataFrame, str]]) -> dict:
        self._clear_sessions_and_schedules(db)
        seed_reference_data(db)

        errors: list[dict] = []
        rows_imported = 0
        rows_read = sum(int(len(frame.index)) for frame, _ in frames)
        if not frames or all(frame.empty for frame, _ in frames):
            db.commit()
            return {
                "rows_read": 0,
                "rows_imported": 0,
                "rows_failed": 1,
                "errors": [
                    {
                        "row": 0,
                        "field": "Workbook",
                        "message": "No usable timetable rows found. Add rows with at least a Module Code, Student Group, Class Type, Staff, class size, and duration.",
                    }
                ],
            }

        for frame, source_filename in frames:
            if frame.empty:
                errors.append(
                    {
                        "row": 0,
                        "field": "Workbook",
                        "message": f"{source_filename}: no usable timetable rows found.",
                    }
                )
                continue

            for index, row in frame.iterrows():
                source_row_no = self._source_row_no(row.get("Source Row No"), int(index))
                try:
                    count = self._positive_int(row.get("Session Count")) or 1
                    for _ in range(count):
                        session = self._build_session(db, row, source_filename, source_row_no)
                        db.add(session)
                        rows_imported += 1
                except Exception as exc:  # Defensive: one bad row should not block the whole upload.
                    errors.append(
                        {
                            "row": source_row_no,
                            "field": "Row",
                            "message": f"{source_filename}: could not import row: {exc}",
                        }
                    )

        db.commit()
        return {
            "rows_read": rows_read,
            "rows_imported": rows_imported,
            "rows_failed": len(errors),
            "errors": errors,
        }

    def _choose_sheet(self, sheet_names: list[str]) -> str:
        for preferred in ["Input_Template", "Timetable", "Template"]:
            if preferred in sheet_names:
                return preferred
        return sheet_names[0]

    def _prepare_frame(self, frame: pd.DataFrame) -> pd.DataFrame:
        rename_map = {}
        for column in frame.columns:
            canonical = ALIAS_LOOKUP.get(_normalise_column_name(str(column)))
            if canonical:
                rename_map[column] = canonical
        frame = frame.rename(columns=rename_map)
        frame = self._coalesce_duplicate_columns(frame)
        frame = self._filter_data_rows(frame)
        if "Requirement ID" not in frame.columns:
            frame["Requirement ID"] = [f"REQ-{index + 1:04d}" for index in range(len(frame.index))]
        if "Programme" not in frame.columns:
            frame["Programme"] = frame.apply(self._derive_programme, axis=1)
        if "Year" not in frame.columns:
            frame["Year"] = frame.apply(self._derive_year, axis=1)
        if "Scheduling Type" not in frame.columns and {
            "Fixed Day",
            "Fixed Start Time",
            "Fixed End Time",
        }.issubset(frame.columns):
            frame["Scheduling Type"] = frame.apply(self._derive_scheduling_type, axis=1)
        if "Week Pattern" not in frame.columns:
            frame["Week Pattern"] = frame["Custom Weeks"].apply(lambda value: "Custom" if clean_text(value) else "Weekly") if "Custom Weeks" in frame.columns else "Weekly"
        if "Start Week" not in frame.columns:
            frame["Start Week"] = 1
        if "End Week" not in frame.columns:
            frame["End Week"] = 13
        if "Sessions Per Week" not in frame.columns:
            frame["Sessions Per Week"] = 1
        if "Delivery Mode" not in frame.columns:
            frame["Delivery Mode"] = "Face-to-face"
        if "Campus Mode" not in frame.columns:
            frame["Campus Mode"] = "Physical"
        if "Venue Type Required" not in frame.columns and "Class Type" in frame.columns:
            frame["Venue Type Required"] = frame["Class Type"]
        return frame

    def _coalesce_duplicate_columns(self, frame: pd.DataFrame) -> pd.DataFrame:
        result = pd.DataFrame(index=frame.index)
        for column in dict.fromkeys(frame.columns):
            values = frame.loc[:, frame.columns == column]
            if values.shape[1] == 1:
                result[column] = values.iloc[:, 0]
            else:
                result[column] = values.bfill(axis=1).iloc[:, 0]
        return result

    def _filter_data_rows(self, frame: pd.DataFrame) -> pd.DataFrame:
        if "Module Code" not in frame.columns:
            return frame.iloc[0:0].copy()
        keep_mask = frame["Module Code"].apply(lambda value: clean_text(value) is not None)
        return frame.loc[keep_mask].copy()

    def _derive_programme(self, row) -> str:
        for value in [row.get("Module Host Key"), row.get("Module Code")]:
            text = clean_text(value)
            if not text:
                continue
            parts = text.split("-")
            if len(parts) >= 3:
                return parts[2].upper()
            match = re.match(r"([A-Za-z]+)", text)
            if match:
                return match.group(1).upper()
        return "UNKNOWN"

    def _derive_year(self, row) -> int:
        module_code = clean_text(row.get("Module Code")) or ""
        match = re.search(r"(\d)", module_code)
        if match:
            return max(1, min(int(match.group(1)), 6))
        return 1

    def _derive_scheduling_type(self, row) -> str:
        has_fixed_time = any(
            clean_text(row.get(column))
            for column in ["Fixed Day", "Fixed Start Time", "Fixed End Time"]
        )
        return "Fixed" if has_fixed_time else "Flexible"

    def _clear_sessions_and_schedules(self, db: DbSession) -> None:
        db.query(ConstraintViolation).delete()
        db.query(ScheduledSession).delete()
        db.query(ScheduleRun).delete()
        db.query(Session).delete()
        db.commit()

    def _build_session(
        self,
        db: DbSession,
        row,
        source_filename: str,
        source_row_no: int,
    ) -> Session:
        programme = self._get_or_create_programme(db, row)
        module = self._get_or_create_module(db, row)
        group = self._get_or_create_group(db, row, programme)
        staff = self._get_or_create_staff(db, row)
        duration = self._duration_minutes(row)
        fixed_start = self._time_string(row.get("Fixed Start Time"))
        fixed_end = self._time_string(row.get("Fixed End Time"))

        return Session(
            requirement_id=clean_text(row.get("Requirement ID")),
            programme_id=programme.id if programme else None,
            module_id=module.id if module else None,
            student_group_id=group.id if group else None,
            staff_id=staff.id if staff else None,
            class_type=clean_text(row.get("Class Type")),
            delivery_mode=canonical_delivery_mode(row.get("Delivery Mode")),
            campus_mode=clean_text(row.get("Campus Mode")),
            venue_type_required=clean_text(row.get("Venue Type Required")),
            duration_minutes=duration,
            sessions_per_week=self._positive_int(row.get("Sessions Per Week")),
            exact_class_size=self._positive_int(row.get("Exact Class Size")),
            start_week=self._positive_int(row.get("Start Week")),
            end_week=self._positive_int(row.get("End Week")),
            week_pattern=canonical_week_pattern(row.get("Week Pattern")),
            custom_weeks=clean_text(row.get("Custom Weeks")),
            scheduling_type=clean_text(row.get("Scheduling Type")),
            fixed_day=canonical_day(row.get("Fixed Day")),
            fixed_date=clean_text(row.get("Fixed Date")),
            fixed_start_time=fixed_start,
            fixed_end_time=fixed_end,
            preferred_days=clean_text(row.get("Preferred Days")),
            avoid_days=clean_text(row.get("Avoid Days")),
            priority=clean_text(row.get("Priority")) or "Normal",
            common_module_flag=self._to_bool(row.get("Common Module?")),
            shared_session_group_id=clean_text(row.get("Shared Session Group ID")),
            combined_with_programmes=clean_text(row.get("Combined With Programmes")),
            hard_constraint_notes=clean_text(row.get("Hard Constraint Notes")),
            soft_preference_notes=clean_text(row.get("Soft Preference Notes")),
            remarks=clean_text(row.get("Remarks")),
            source_file=clean_text(row.get("Source File")) or source_filename,
            source_row_no=source_row_no,
        )

    def _get_or_create_programme(self, db: DbSession, row) -> Programme | None:
        value = clean_text(row.get("Programme"))
        if not value:
            return None
        code = value.split()[0].strip().upper()
        programme = db.query(Programme).filter_by(code=code).first()
        if programme:
            return programme
        programme = Programme(code=code, name=value, cluster=None)
        db.add(programme)
        db.flush()
        return programme

    def _get_or_create_module(self, db: DbSession, row) -> Module | None:
        module_code = clean_text(row.get("Module Code"))
        if not module_code:
            return None
        host_key = clean_text(row.get("Module Host Key"))
        module = db.query(Module).filter_by(module_code=module_code).first()
        if module:
            return module
        module = Module(
            module_code=module_code,
            module_host_key=host_key,
            module_title=clean_text(row.get("Module Title")) or module_code,
            term=None,
        )
        db.add(module)
        db.flush()
        return module

    def _get_or_create_group(
        self,
        db: DbSession,
        row,
        programme: Programme | None,
    ) -> StudentGroup | None:
        group_code = clean_text(row.get("Student Group Code"))
        if not group_code:
            return None
        group = db.query(StudentGroup).filter_by(group_code=group_code).first()
        if group:
            if programme and group.programme_id is None:
                group.programme_id = programme.id
            year = self._positive_int(row.get("Year"))
            if year and group.year is None:
                group.year = year
            size = self._positive_int(row.get("Exact Class Size"))
            if size and group.size is None:
                group.size = size
            return group
        group = StudentGroup(
            group_code=group_code,
            programme_id=programme.id if programme else None,
            year=self._positive_int(row.get("Year")),
            size=self._positive_int(row.get("Exact Class Size")),
        )
        db.add(group)
        db.flush()
        return group

    def _get_or_create_staff(self, db: DbSession, row) -> Staff | None:
        staff_id = clean_text(row.get("Staff 1 ID"))
        staff_name = clean_text(row.get("Staff 1 Name"))
        if not staff_id and not staff_name:
            return None
        staff = None
        if staff_id:
            staff = db.query(Staff).filter_by(staff_id=staff_id).first()
        if not staff and staff_name:
            staff = db.query(Staff).filter_by(staff_name=staff_name).first()
        if staff:
            return staff
        staff = Staff(staff_id=staff_id, staff_name=staff_name, staff_host_key=None)
        db.add(staff)
        db.flush()
        return staff

    def _duration_minutes(self, row) -> int | None:
        fixed_start = time_to_minutes(row.get("Fixed Start Time"))
        fixed_end = time_to_minutes(row.get("Fixed End Time"))
        if fixed_start is not None and fixed_end is not None and fixed_end > fixed_start:
            return fixed_end - fixed_start
        minutes = self._positive_int(row.get("Duration Minutes"))
        if minutes:
            return minutes
        hours = self._positive_float(row.get("Duration Hours"))
        if hours is None:
            raw_duration = self._positive_float(row.get("Duration Raw"))
            if raw_duration is None:
                return None
            return int(raw_duration * 20)
        return int(hours * 60)

    def _positive_int(self, value) -> int | None:
        number = self._positive_float(value)
        if number is None:
            return None
        if number <= 0:
            return None
        return int(number)

    def _source_row_no(self, value, index: int) -> int:
        row_no = self._positive_int(value)
        if row_no and row_no >= 2:
            return row_no
        return index + 2

    def _positive_float(self, value) -> float | None:
        if isinstance(value, bool):
            return None
        text = clean_text(value)
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            return None

    def _time_string(self, value) -> str | None:
        minutes = time_to_minutes(value)
        if minutes is None:
            return None
        return minutes_to_time(minutes)

    def _to_bool(self, value) -> bool:
        text = (clean_text(value) or "").lower()
        return text in {"yes", "y", "true", "1", "common"}
