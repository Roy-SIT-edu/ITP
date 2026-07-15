"""Export service for converting generated schedules to CSV or Excel files."""

from __future__ import annotations

from io import BytesIO, StringIO

import pandas as pd
from app.models.scheduled_session import ScheduledSession
from app.services.serializers import session_staff_ids, session_staff_names
from sqlalchemy.orm import Session as DbSession


class ExportService:
    def schedule_rows(self, db: DbSession, schedule_run_id: int) -> list[dict]:
        scheduled = (
            db.query(ScheduledSession)
            .filter(
                ScheduledSession.schedule_run_id == schedule_run_id,
                ScheduledSession.included_in_final.is_(True),
            )
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
                    "week_pattern": item.week_pattern,
                    "delivery_mode": session.delivery_mode,
                    "campus_mode": session.campus_mode,
                }
            )
        return rows

    def csv_buffer(self, db: DbSession, schedule_run_id: int) -> StringIO:
        buffer = StringIO()
        pd.DataFrame(self.schedule_rows(db, schedule_run_id)).to_csv(buffer, index=False)
        buffer.seek(0)
        return buffer

    def xlsx_buffer(self, db: DbSession, schedule_run_id: int) -> BytesIO:
<<<<<<< Updated upstream
=======
        return self.system_template_xlsx_buffer(db, schedule_run_id)

    def system_template_rows(self, db: DbSession, schedule_run_id: int) -> list[dict]:
        scheduled = (
            db.query(ScheduledSession)
            .filter(
                ScheduledSession.schedule_run_id == schedule_run_id,
                ScheduledSession.included_in_final.is_(True),
            )
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
>>>>>>> Stashed changes
        buffer = BytesIO()
        with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
            pd.DataFrame(self.schedule_rows(db, schedule_run_id)).to_excel(
                writer,
                index=False,
                sheet_name="Generated_Timetable",
            )
        buffer.seek(0)
        return buffer
