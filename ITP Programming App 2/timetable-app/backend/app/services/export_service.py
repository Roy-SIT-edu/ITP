"""Export service for converting generated schedules to CSV or Excel files."""

from __future__ import annotations

from io import BytesIO, StringIO

import pandas as pd
from sqlalchemy.orm import Session as DbSession

from app.models.scheduled_session import ScheduledSession
from app.services.serializers import session_staff_ids, session_staff_names


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
        buffer = BytesIO()
        with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
            pd.DataFrame(self.schedule_rows(db, schedule_run_id)).to_excel(
                writer,
                index=False,
                sheet_name="Generated_Timetable",
            )
        buffer.seek(0)
        return buffer
