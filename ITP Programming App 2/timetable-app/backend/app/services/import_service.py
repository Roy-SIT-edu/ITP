"""Excel import service for requirements workbooks.

This service normalizes varied spreadsheet column names, validates every row
against the database, and only replaces requirements after the full batch passes.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import BinaryIO

import pandas as pd
from app.models.session import Session
from app.models.session_staff import SessionStaff
from app.services.compatibility import clean_text, positive_float, positive_int
from app.services.requirement_input_service import RequirementInputService, RequirementUploadRow
from app.services.schedule_state_service import clear_schedule_state
from sqlalchemy.orm import Session as DbSession

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
    "Venue Request": ["venue request", "venue requests"],
    "Campus Mode": ["campus mode", "campus"],
    "Exact Class Size": ["exact class size", "required exact class size", "class size", "size"],
    "Staff 1 Name": ["staff 1 name", "staff name", "tutor name", "lecturer name", "staff1"],
    "Staff 1 ID": ["staff 1 id", "staff id", "tutor id", "lecturer id", "sis staff id", "staff suitability id"],
    "Staff 2 Name": ["staff 2 name", "staff2"],
    "Staff 2 ID": ["staff 2 id"],
    "Staff 3 Name": ["staff 3 name", "staff3"],
    "Staff 3 ID": ["staff 3 id"],
    "Staff 4 Name": ["staff 4 name", "staff4"],
    "Staff 4 ID": ["staff 4 id"],
    "Start Week": ["start week"],
    "End Week": ["end week"],
    "Week Pattern": ["week pattern", "weeks pattern"],
    "Custom Weeks": ["custom weeks", "tri week"],
    "Specific Week": ["specific week"],
    "Scheduling Type": ["scheduling type", "schedule type"],
    "Preferred Days": ["preferred days", "preferred day"],
    "Avoid Days": ["avoid days", "avoid day"],
    "Fixed Day": ["fixed day", "specific day", "day"],
    "Fixed Date": ["fixed date", "specific date"],
    "Fixed Start Time": ["fixed start time", "fixed start", "start", "start time"],
    "Fixed End Time": ["fixed end time", "fixed end", "end", "end time"],
    "Priority": ["priority"],
    "Common Module?": ["common module?", "common module", "common module flag"],
    "Shared Session Group ID": ["shared session group id", "shared group id"],
    "Combined With Programmes": ["combined with programmes", "combined programmes"],
    "Hard Constraint Notes": ["hard constraint notes", "hard constraints"],
    "Soft Preference Notes": ["soft preference notes", "soft preferences"],
    "Remarks": ["remarks", "notes"],
    "Cleanup Notes": ["cleanup notes"],
    "Source File": ["source file"],
    "Source Row No": ["source row no", "source row number"],
}


def _normalise_column_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


ALIAS_LOOKUP = {
    _normalise_column_name(alias): canonical for canonical, aliases in CANONICAL_COLUMNS.items() for alias in [canonical, *aliases]
}


REQUIRED_TEMPLATE_COLUMNS = [
    "Requirement ID",
    "Programme",
    "Year",
    "Module Code",
    "Class Type",
    "Session Count",
    "Duration Hours",
    "Sessions Per Week",
    "Delivery Mode",
    "Venue Type Required",
    "Exact Class Size",
    "Staff 1 ID",
]


@dataclass(frozen=True)
class PreparedWorkbook:
    frame: pd.DataFrame
    errors: list[dict]
    rows_read: int
    columns: list[str]


class ImportService:
    def import_upload(self, db: DbSession, file: BinaryIO, filename: str) -> dict:
        data = file.read()
        return self.import_input_template_bytes(db, data, source_filename=filename)

    def import_input_template_files(
        self,
        db: DbSession,
        workbooks: list[tuple[bytes, str]],
    ) -> dict:
        prepared = [(self._read_workbook(BytesIO(workbook_bytes)), source_filename) for workbook_bytes, source_filename in workbooks]
        return self._import_prepared(db, prepared)

    def preview_input_template_files(
        self,
        db: DbSession,
        workbooks: list[tuple[bytes, str]],
    ) -> dict:
        prepared = [(self._read_workbook(BytesIO(workbook_bytes)), source_filename) for workbook_bytes, source_filename in workbooks]
        return self._preview_prepared(db, prepared)

    def import_input_template_bytes(
        self,
        db: DbSession,
        workbook_bytes: bytes,
        source_filename: str,
    ) -> dict:
        prepared = self._read_workbook(BytesIO(workbook_bytes))
        return self._import_prepared(db, [(prepared, source_filename)])

    def import_input_template(
        self,
        db: DbSession,
        workbook_path: str | Path,
        source_filename: str | None = None,
    ) -> dict:
        source_filename = source_filename or Path(workbook_path).name
        prepared = self._read_workbook(workbook_path)
        return self._import_prepared(db, [(prepared, source_filename)])

    def _read_workbook(self, workbook_source) -> PreparedWorkbook:
        with pd.ExcelFile(workbook_source) as xls:
            if "Input_Template" in xls.sheet_names:
                required = pd.read_excel(xls, sheet_name="Input_Template").dropna(how="all")
                optional = (
                    pd.read_excel(xls, sheet_name="Remarks_(optional)").dropna(how="all")
                    if "Remarks_(optional)" in xls.sheet_names
                    else pd.DataFrame()
                )
                return self._prepare_two_tab_workbook(required, optional)

            sheet_name = self._choose_sheet(xls.sheet_names)
            frame = pd.read_excel(xls, sheet_name=sheet_name).dropna(how="all")
            prepared = self._prepare_frame(frame, require_documented_shape=False)
            return PreparedWorkbook(
                frame=prepared,
                errors=[],
                rows_read=int(len(prepared.index)),
                columns=[str(column) for column in prepared.columns],
            )

    def _import_prepared(self, db: DbSession, prepared_workbooks: list[tuple[PreparedWorkbook, str]]) -> dict:
        errors: list[dict] = []
        rows_read = sum(item.rows_read for item, _ in prepared_workbooks)
        file_summaries = self._file_summaries(prepared_workbooks)
        for prepared, source_filename in prepared_workbooks:
            for error in prepared.errors:
                errors.append({**error, "source_file": source_filename})

        if not prepared_workbooks or all(prepared.frame.empty for prepared, _ in prepared_workbooks):
            return {
                "rows_read": 0,
                "rows_imported": 0,
                "rows_failed": max(1, len(errors)),
                "file_summaries": file_summaries,
                "errors": errors
                or [
                    {
                        "row": 0,
                        "field": "Workbook",
                        "message": "No usable timetable rows found. Add rows to Input_Template with Requirement ID, Module Code, Class Type, Staff 1 ID, class size, and duration.",
                    }
                ],
            }

        upload_rows: list[RequirementUploadRow] = []
        for prepared, source_filename in prepared_workbooks:
            frame = prepared.frame
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
                upload_rows.append(RequirementUploadRow(row=row, source_filename=source_filename, source_row_no=source_row_no))

        service = RequirementInputService()
        session_data, validation_errors = service.validate_upload_rows(db, upload_rows)
        errors.extend(validation_errors)
        if errors:
            db.rollback()
            return {
                "rows_read": rows_read,
                "rows_imported": 0,
                "rows_failed": len(errors),
                "file_summaries": self._summaries_with_errors(file_summaries, errors),
                "errors": errors,
            }

        self._clear_sessions_and_schedules(db)
        for data in session_data:
            db.add(service.session_from_data(data))

        db.commit()
        return {
            "rows_read": rows_read,
            "rows_imported": len(session_data),
            "rows_failed": len(errors),
            "file_summaries": file_summaries,
            "errors": errors,
        }

    def _preview_prepared(self, db: DbSession, prepared_workbooks: list[tuple[PreparedWorkbook, str]]) -> dict:
        rows_read = sum(item.rows_read for item, _ in prepared_workbooks)
        file_summaries = self._file_summaries(prepared_workbooks)
        errors = []
        for prepared, source_filename in prepared_workbooks:
            for error in prepared.errors:
                errors.append({**error, "source_file": source_filename})

        if not prepared_workbooks or all(prepared.frame.empty for prepared, _ in prepared_workbooks):
            return {
                "rows_read": 0,
                "rows_importable": 0,
                "rows_failed": max(1, len(errors)),
                "file_summaries": file_summaries,
                "errors": errors
                or [
                    {
                        "row": 0,
                        "field": "Workbook",
                        "message": "No usable timetable rows found. Add rows to Input_Template with Requirement ID, Module Code, Class Type, Staff 1 ID, class size, and duration.",
                    }
                ],
            }

        upload_rows: list[RequirementUploadRow] = []
        for prepared, source_filename in prepared_workbooks:
            frame = prepared.frame
            for index, row in frame.iterrows():
                upload_rows.append(
                    RequirementUploadRow(
                        row=row, source_filename=source_filename, source_row_no=self._source_row_no(row.get("Source Row No"), int(index))
                    )
                )

        session_data, validation_errors = RequirementInputService().validate_upload_rows(db, upload_rows)
        errors.extend(validation_errors)
        db.rollback()
        return {
            "rows_read": rows_read,
            "rows_importable": len(session_data) if not errors else 0,
            "rows_failed": len(errors),
            "file_summaries": self._summaries_with_errors(file_summaries, errors),
            "errors": errors,
        }

    def _file_summaries(self, prepared_workbooks: list[tuple[PreparedWorkbook, str]]) -> list[dict]:
        return [
            {
                "filename": source_filename,
                "rows_read": prepared.rows_read,
                "columns": prepared.columns,
            }
            for prepared, source_filename in prepared_workbooks
        ]

    def _summaries_with_errors(self, file_summaries: list[dict], errors: list[dict]) -> list[dict]:
        counts = {}
        for error in errors:
            source = error.get("source_file")
            if source:
                counts[source] = counts.get(source, 0) + 1
        return [
            {
                **summary,
                "error_count": counts.get(summary["filename"], 0),
            }
            for summary in file_summaries
        ]

    def _choose_sheet(self, sheet_names: list[str]) -> str:
        for preferred in ["Input_Template", "Timetable", "Template"]:
            if preferred in sheet_names:
                return preferred
        return sheet_names[0]

    def _prepare_two_tab_workbook(self, required: pd.DataFrame, optional: pd.DataFrame) -> PreparedWorkbook:
        required = self._canonicalize_columns(required)
        optional = self._canonicalize_columns(optional) if not optional.empty else pd.DataFrame()
        required = self._filter_data_rows(required)
        optional = optional.dropna(how="all").copy()
        errors: list[dict] = []

        missing = [column for column in REQUIRED_TEMPLATE_COLUMNS if column not in required.columns]
        for column in missing:
            errors.append(self._template_issue(1, column, f"Input_Template is missing required column '{column}'."))

        if "Requirement ID" in required.columns:
            seen: dict[str, int] = {}
            for index, row in required.iterrows():
                row_no = int(index) + 2
                requirement_id = clean_text(row.get("Requirement ID"))
                if not requirement_id:
                    errors.append(self._template_issue(row_no, "Requirement ID", "Requirement ID is required."))
                    continue
                key = requirement_id.lower()
                if key in seen:
                    errors.append(
                        self._template_issue(
                            row_no, "Requirement ID", f"Duplicate Requirement ID '{requirement_id}'. First seen on row {seen[key]}."
                        )
                    )
                else:
                    seen[key] = row_no

        if not optional.empty:
            if "Requirement ID" not in optional.columns:
                errors.append(
                    self._template_issue(
                        1,
                        "Remarks_(optional)",
                        "Remarks_(optional) must include Requirement ID so optional values can join to Input_Template.",
                    )
                )
            else:
                required_ids = {
                    (clean_text(value) or "").lower()
                    for value in required.get("Requirement ID", pd.Series(dtype=object))
                    if clean_text(value)
                }
                seen_optional: dict[str, int] = {}
                for index, row in optional.iterrows():
                    row_no = int(index) + 2
                    requirement_id = clean_text(row.get("Requirement ID"))
                    if not requirement_id:
                        errors.append(
                            self._template_issue(
                                row_no, "Requirement ID", "Optional rows must include Requirement ID or be left completely blank."
                            )
                        )
                        continue
                    key = requirement_id.lower()
                    if key in seen_optional:
                        errors.append(
                            self._template_issue(
                                row_no,
                                "Requirement ID",
                                f"Duplicate optional row for Requirement ID '{requirement_id}'. First seen on row {seen_optional[key]}.",
                            )
                        )
                    elif key not in required_ids:
                        errors.append(
                            self._template_issue(
                                row_no, "Requirement ID", f"Optional row references unknown Requirement ID '{requirement_id}'."
                            )
                        )
                    else:
                        seen_optional[key] = row_no

        merged = required.copy()
        if not optional.empty and "Requirement ID" in optional.columns:
            optional_by_id = {
                (clean_text(row.get("Requirement ID")) or "").lower(): row
                for _, row in optional.iterrows()
                if clean_text(row.get("Requirement ID"))
            }
            optional_columns = [column for column in optional.columns if column != "Requirement ID"]
            for index, row in merged.iterrows():
                optional_row = optional_by_id.get((clean_text(row.get("Requirement ID")) or "").lower())
                if optional_row is None:
                    continue
                for column in optional_columns:
                    if clean_text(optional_row.get(column)) is not None:
                        merged.at[index, column] = optional_row.get(column)

        merged = self._apply_template_defaults(merged)
        return PreparedWorkbook(
            frame=merged,
            errors=errors,
            rows_read=int(len(required.index)),
            columns=[str(column) for column in merged.columns],
        )

    def _prepare_frame(self, frame: pd.DataFrame, require_documented_shape: bool = True) -> pd.DataFrame:
        frame = self._canonicalize_columns(frame)
        frame = self._filter_data_rows(frame)
        if require_documented_shape and "Requirement ID" not in frame.columns:
            frame["Requirement ID"] = [f"REQ-{index + 1:04d}" for index in range(len(frame.index))]
        return self._apply_template_defaults(frame)

    def _canonicalize_columns(self, frame: pd.DataFrame) -> pd.DataFrame:
        rename_map = {}
        for column in frame.columns:
            canonical = ALIAS_LOOKUP.get(_normalise_column_name(str(column)))
            if canonical:
                rename_map[column] = canonical
        frame = frame.rename(columns=rename_map)
        return self._coalesce_duplicate_columns(frame)

    def _apply_template_defaults(self, frame: pd.DataFrame) -> pd.DataFrame:
        if "Programme" not in frame.columns:
            frame["Programme"] = frame.apply(self._derive_programme, axis=1)
        if "Year" not in frame.columns:
            frame["Year"] = frame.apply(self._derive_year, axis=1)
        if "Student Group Code" not in frame.columns:
            frame["Student Group Code"] = None
        self._apply_specific_week_defaults(frame)
        self._apply_specific_date_defaults(frame)
        if "Scheduling Type" not in frame.columns:
            frame["Scheduling Type"] = None
        frame["Scheduling Type"] = frame.apply(
            lambda row: (
                "Fixed"
                if all(clean_text(row.get(column)) for column in ("Fixed Day", "Fixed Start Time", "Fixed End Time"))
                else clean_text(row.get("Scheduling Type")) or "Flexible"
            ),
            axis=1,
        )
        if "Week Pattern" not in frame.columns:
            frame["Week Pattern"] = None
        frame["Week Pattern"] = frame.apply(
            lambda row: clean_text(row.get("Week Pattern")) or ("Custom" if clean_text(row.get("Custom Weeks")) else "Weekly"),
            axis=1,
        )
        if "Start Week" not in frame.columns:
            frame["Start Week"] = None
        frame["Start Week"] = frame["Start Week"].apply(lambda value: self._positive_int(value) or 1)
        if "End Week" not in frame.columns:
            frame["End Week"] = None
        frame["End Week"] = frame["End Week"].apply(lambda value: self._positive_int(value) or 13)
        if "Sessions Per Week" not in frame.columns:
            frame["Sessions Per Week"] = None
        frame["Sessions Per Week"] = frame["Sessions Per Week"].apply(lambda value: self._positive_int(value) or 1)
        if "Delivery Mode" not in frame.columns:
            frame["Delivery Mode"] = "Face-to-face"
        if "Campus Mode" not in frame.columns:
            frame["Campus Mode"] = frame["Delivery Mode"].apply(self._derive_campus_mode)
        else:
            frame["Campus Mode"] = frame.apply(
                lambda row: clean_text(row.get("Campus Mode")) or self._derive_campus_mode(row.get("Delivery Mode")),
                axis=1,
            )
        if "Venue Type Required" not in frame.columns and "Class Type" in frame.columns:
            frame["Venue Type Required"] = frame["Class Type"]
        if "Hard Constraint Notes" not in frame.columns and "Venue Request" in frame.columns:
            frame["Hard Constraint Notes"] = frame["Venue Request"]
        elif "Venue Request" in frame.columns:
            frame["Hard Constraint Notes"] = frame["Hard Constraint Notes"].combine_first(frame["Venue Request"])
        if "Remarks" not in frame.columns and "Cleanup Notes" in frame.columns:
            frame["Remarks"] = frame["Cleanup Notes"]
        return frame

    def _apply_specific_week_defaults(self, frame: pd.DataFrame) -> None:
        if "Specific Week" not in frame.columns:
            return
        if "Custom Weeks" not in frame.columns:
            frame["Custom Weeks"] = None
        for index, row in frame.iterrows():
            week = self._positive_int(row.get("Specific Week"))
            if not week:
                continue
            frame.at[index, "Week Pattern"] = "Custom"
            frame.at[index, "Custom Weeks"] = str(week)
            if clean_text(row.get("Start Week")) is None:
                frame.at[index, "Start Week"] = week
            if clean_text(row.get("End Week")) is None:
                frame.at[index, "End Week"] = week

    def _apply_specific_date_defaults(self, frame: pd.DataFrame) -> None:
        if "Fixed Date" not in frame.columns:
            return
        for index, row in frame.iterrows():
            fixed_date = row.get("Fixed Date")
            if clean_text(fixed_date) is None or clean_text(row.get("Fixed Day")) is not None:
                continue
            parsed = pd.to_datetime(fixed_date, errors="coerce")
            if pd.notna(parsed):
                frame.at[index, "Fixed Day"] = parsed.day_name()

    def _derive_campus_mode(self, delivery_mode: object) -> str | None:
        token = re.sub(r"[^a-z0-9]+", " ", (clean_text(delivery_mode) or "").lower()).strip()
        if token in {"online", "online synchronous", "asynchronous", "online asynchronous", "async"}:
            return "Virtual"
        if token in {"face to face", "f2f", "physical", "in person"}:
            return "Physical"
        return None

    def _template_issue(self, row: int, field: str, message: str) -> dict:
        return {"row": row, "field": field, "message": message}

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

    def _clear_sessions_and_schedules(self, db: DbSession) -> None:
        clear_schedule_state(db)
        db.query(SessionStaff).delete()
        db.query(Session).delete()

    def _positive_int(self, value) -> int | None:
        return positive_int(value)

    def _source_row_no(self, value, index: int) -> int:
        row_no = self._positive_int(value)
        if row_no and row_no >= 2:
            return row_no
        return index + 2

    def _positive_float(self, value) -> float | None:
        return positive_float(value)
