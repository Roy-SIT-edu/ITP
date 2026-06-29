"""Export service for converting generated schedules to CSV or Excel files."""

from __future__ import annotations

from collections import defaultdict
from io import BytesIO, StringIO

import pandas as pd
from app.models.scheduled_session import ScheduledSession
from app.services.compatibility import clean_text, normalize_token, parse_custom_weeks, time_to_minutes
from app.services.serializers import session_staff_ids, session_staff_items, session_staff_names
from app.services.student_group_service import student_group_partition
from sqlalchemy.orm import Session as DbSession

SYSTEM_TEMPLATE_COLUMNS = [
    "Module",
    "Class Type",
    "Template",
    "Group",
    "Day",
    "Start",
    "End",
    "Class Size",
    "Sector",
    "RoomGrouping",
    "Room1",
    "Room2",
    "StaffGrouping",
    "Staff1",
    "Staff2",
    "Tri Week",
    "Recording Mode",
    "Remark",
]

DAY_LABELS = {
    "Monday": "Mon",
    "Tuesday": "Tue",
    "Wednesday": "Wed",
    "Thursday": "Thu",
    "Friday": "Fri",
    "Saturday": "Sat",
    "Sunday": "Sun",
}

GROUP_PREFIX_BY_CLASS_TYPE = {
    "lecture": "L",
    "lectorial": "L",
    "laboratory": "L",
    "lab": "L",
    "tutorial": "T",
    "quiz": "Q",
    "workshop": "W",
    "seminar": "S",
    "practicum": "P",
}

DEFAULT_SECTOR = "PUNGGOL"


class ExportService:
    def schedule_rows(self, db: DbSession, schedule_run_id: int) -> list[dict]:
        scheduled = (
            db.query(ScheduledSession)
            .filter_by(schedule_run_id=schedule_run_id)
            .order_by(ScheduledSession.day, ScheduledSession.start_time)
            .all()
        )
        rows = []
        for item in scheduled:
            session = item.session
            rows.append(
                {
                    "scheduled_session_id": item.id,
                    "session_id": session.id,
                    "requirement_id": session.requirement_id,
                    "programme": session.programme.code if session.programme else None,
                    "year": session.student_group.year if session.student_group else None,
                    "module_code": session.module.module_code if session.module else None,
                    "class_type": session.class_type,
                    "student_group_code": session.student_group.group_code if session.student_group else None,
                    "staff_name": session.staff.staff_name if session.staff else None,
                    "staff_id": session.staff.staff_id if session.staff else None,
                    "co_teacher_names": session_staff_names(session),
                    "co_teacher_ids": session_staff_ids(session),
                    "room": item.room.room_code,
                    "day": item.day,
                    "start_time": item.start_time,
                    "end_time": item.end_time,
                    "start_week": session.start_week,
                    "end_week": session.end_week,
                    "week_pattern": item.week_pattern,
                    "custom_weeks": session.custom_weeks,
                    "delivery_mode": session.delivery_mode,
                    "campus_mode": session.campus_mode,
                }
            )
        return rows

    def csv_buffer(self, db: DbSession, schedule_run_id: int) -> StringIO:
        buffer = StringIO()
        pd.DataFrame(
            self.system_template_rows(db, schedule_run_id),
            columns=SYSTEM_TEMPLATE_COLUMNS,
        ).to_csv(buffer, index=False)
        buffer.seek(0)
        return buffer

    def xlsx_buffer(self, db: DbSession, schedule_run_id: int) -> BytesIO:
        return self.system_template_xlsx_buffer(db, schedule_run_id)

    def system_template_rows(self, db: DbSession, schedule_run_id: int) -> list[dict]:
        scheduled = (
            db.query(ScheduledSession)
            .filter_by(schedule_run_id=schedule_run_id)
            .all()
        )
        rows = []
        template_numbers: dict[tuple[str | None, str | None], dict[tuple, int]] = defaultdict(dict)
        for item in sorted(scheduled, key=self._system_template_sort_key):
            session = item.session
            module_code = session.module.module_code if session.module else None
            class_type = clean_text(session.class_type)
            staff_names = self._staff_names(session)
            tri_week = self._tri_week_value(session, item)
            template = self._template_number(
                template_numbers,
                module_code,
                class_type,
                (
                    tri_week,
                    staff_names[0],
                    staff_names[1],
                    self._day_label(item.day),
                    self._time_label(item.start_time),
                    self._time_label(item.end_time),
                ),
            )
            rows.append(
                {
                    "Module": module_code,
                    "Class Type": class_type,
                    "Template": template,
                    "Group": self._group_label(session),
                    "Day": self._day_label(item.day),
                    "Start": self._time_label(item.start_time),
                    "End": self._time_label(item.end_time),
                    "Class Size": session.exact_class_size,
                    "Sector": DEFAULT_SECTOR,
                    "RoomGrouping": None,
                    "Room1": item.room.room_code if item.room else None,
                    "Room2": None,
                    "StaffGrouping": None,
                    "Staff1": staff_names[0],
                    "Staff2": staff_names[1],
                    "Tri Week": tri_week,
                    "Recording Mode": self._recording_mode(item),
                    "Remark": self._remark(session),
                }
            )
        return rows

    def system_template_xlsx_buffer(self, db: DbSession, schedule_run_id: int) -> BytesIO:
        buffer = BytesIO()
        with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
            pd.DataFrame(
                self.system_template_rows(db, schedule_run_id),
                columns=SYSTEM_TEMPLATE_COLUMNS,
            ).to_excel(
                writer,
                index=False,
                sheet_name="Sheet1",
            )
        buffer.seek(0)
        return buffer

    def _system_template_sort_key(self, item: ScheduledSession) -> tuple:
        session = item.session
        return (
            clean_text(session.module.module_code if session.module else None) or "",
            clean_text(session.class_type) or "",
            self._tri_week_sort_value(session, item),
            self._day_sort_value(item.day),
            time_to_minutes(item.start_time) or 0,
            self._group_label(session) or "",
        )

    def _template_number(
        self,
        template_numbers: dict[tuple[str | None, str | None], dict[tuple, int]],
        module_code: str | None,
        class_type: str | None,
        signature: tuple,
    ) -> int:
        key = (module_code, class_type)
        templates = template_numbers[key]
        if signature not in templates:
            templates[signature] = len(templates) + 1
        return templates[signature]

    def _staff_names(self, session) -> list[str | None]:
        names = []
        for staff in session_staff_items(session):
            name = clean_text(staff.get("staff_name")) or clean_text(staff.get("staff_id"))
            if name:
                names.append(name.upper())
        return (names + [None, None])[:2]

    def _group_label(self, session) -> str:
        class_type = normalize_token(session.class_type)
        partition = student_group_partition(session.student_group.group_code if session.student_group else None)
        prefix = GROUP_PREFIX_BY_CLASS_TYPE.get(class_type)
        if class_type in {"lecture", "lectorial"} and self._covers_whole_cohort(session):
            return "All"
        if prefix:
            return f"{prefix}{partition or 1}"
        if session.student_group and session.student_group.group_code:
            return session.student_group.group_code
        return "All"

    def _covers_whole_cohort(self, session) -> bool:
        if not session.student_group or not session.student_group.size or not session.exact_class_size:
            return True
        return int(session.exact_class_size) > int(session.student_group.size)

    def _day_label(self, value: object) -> str | None:
        text = clean_text(value)
        return DAY_LABELS.get(text, text)

    def _day_sort_value(self, value: object) -> int:
        labels = list(DAY_LABELS)
        text = clean_text(value)
        return labels.index(text) if text in labels else len(labels)

    def _time_label(self, value: object) -> str | None:
        minutes = time_to_minutes(value)
        if minutes is None:
            return clean_text(value)
        hour, minute = divmod(minutes, 60)
        return f"{hour:02d}{minute:02d}"

    def _tri_week_value(self, session, item: ScheduledSession) -> str | int | None:
        weeks = self._teaching_weeks(session, item)
        if not weeks:
            return None
        if len(weeks) == 1:
            return weeks[0]
        return ",".join(str(week) for week in weeks)

    def _tri_week_sort_value(self, session, item: ScheduledSession) -> tuple:
        weeks = self._teaching_weeks(session, item)
        return tuple(weeks) if weeks else (999,)

    def _teaching_weeks(self, session, item: ScheduledSession) -> list[int]:
        custom_weeks = parse_custom_weeks(session.custom_weeks)
        if custom_weeks:
            return custom_weeks

        start_week = int(session.start_week or 1)
        end_week = int(session.end_week or start_week)
        weeks = list(range(start_week, end_week + 1))
        pattern = normalize_token(session.week_pattern or item.week_pattern or "Weekly")
        if pattern == "odd":
            return [week for week in weeks if week % 2 == 1]
        if pattern == "even":
            return [week for week in weeks if week % 2 == 0]
        return weeks

    def _recording_mode(self, item: ScheduledSession) -> str | None:
        if item.room and item.room.recording_available:
            return "A0"
        return None

    def _remark(self, session) -> str | None:
        combined = clean_text(session.combined_with_programmes)
        if combined:
            return f"w {combined}"
        return clean_text(session.remarks)
