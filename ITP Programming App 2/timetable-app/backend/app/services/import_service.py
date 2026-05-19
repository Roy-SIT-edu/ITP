from __future__ import annotations

import re
from pathlib import Path
from tempfile import NamedTemporaryFile
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
    "Student Group Code": ["student group code", "group code", "student group"],
    "Module Code": ["module code", "module"],
    "Module Host Key": ["module host key", "module host", "host key"],
    "Module Title": ["module title", "title"],
    "Class Type": ["class type", "session type", "activity type"],
    "Session Count": ["session count", "number of sessions", "no of sessions"],
    "Duration Hours": ["duration hours", "duration hrs", "duration"],
    "Duration Minutes": ["duration minutes", "duration mins"],
    "Sessions Per Week": ["sessions per week", "session per week"],
    "Delivery Mode": ["delivery mode", "mode"],
    "Venue Type Required": ["venue type required", "venue required", "venue type"],
    "Campus Mode": ["campus mode", "campus"],
    "Exact Class Size": ["exact class size", "class size", "size"],
    "Staff 1 Name": ["staff 1 name", "staff name", "tutor name", "lecturer name"],
    "Staff 1 ID": ["staff 1 id", "staff id", "tutor id", "lecturer id"],
    "Staff 2 Name": ["staff 2 name"],
    "Staff 2 ID": ["staff 2 id"],
    "Start Week": ["start week"],
    "End Week": ["end week"],
    "Week Pattern": ["week pattern", "weeks pattern"],
    "Custom Weeks": ["custom weeks"],
    "Scheduling Type": ["scheduling type", "schedule type"],
    "Preferred Days": ["preferred days", "preferred day"],
    "Avoid Days": ["avoid days", "avoid day"],
    "Fixed Day": ["fixed day"],
    "Fixed Date": ["fixed date"],
    "Fixed Start Time": ["fixed start time", "fixed start"],
    "Fixed End Time": ["fixed end time", "fixed end"],
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
        suffix = Path(filename).suffix or ".xlsx"
        with NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(file.read())
            temp_path = Path(tmp.name)
        try:
            return self.import_input_template(db, temp_path, source_filename=filename)
        finally:
            temp_path.unlink(missing_ok=True)

    def import_input_template(
        self,
        db: DbSession,
        workbook_path: str | Path,
        source_filename: str | None = None,
    ) -> dict:
        source_filename = source_filename or Path(workbook_path).name
        xls = pd.ExcelFile(workbook_path)
        sheet_name = "Input_Template" if "Input_Template" in xls.sheet_names else xls.sheet_names[0]
        frame = pd.read_excel(workbook_path, sheet_name=sheet_name)
        frame = frame.dropna(how="all")
        frame = self._rename_columns(frame)

        self._clear_sessions_and_schedules(db)
        seed_reference_data(db)

        errors: list[dict] = []
        rows_imported = 0

        for index, row in frame.iterrows():
            source_row_no = int(row.get("Source Row No") or index + 2)
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
                        "message": f"Could not import row: {exc}",
                    }
                )

        db.commit()
        return {
            "rows_read": int(len(frame.index)),
            "rows_imported": rows_imported,
            "rows_failed": len(errors),
            "errors": errors,
        }

    def _rename_columns(self, frame: pd.DataFrame) -> pd.DataFrame:
        rename_map = {}
        for column in frame.columns:
            canonical = ALIAS_LOOKUP.get(_normalise_column_name(str(column)))
            if canonical:
                rename_map[column] = canonical
        return frame.rename(columns=rename_map)

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
        minutes = self._positive_int(row.get("Duration Minutes"))
        if minutes:
            return minutes
        hours = self._positive_float(row.get("Duration Hours"))
        if hours is None:
            return None
        return int(hours * 60)

    def _positive_int(self, value) -> int | None:
        number = self._positive_float(value)
        if number is None:
            return None
        if number <= 0:
            return None
        return int(number)

    def _positive_float(self, value) -> float | None:
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
