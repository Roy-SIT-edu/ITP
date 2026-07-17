"""Academic calendar generation, holiday blocking, and dated occurrences."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from app.models.academic_week import AcademicWeek
from app.models.public_holiday import PublicHoliday
from app.models.schedule_run import ScheduleRun
from app.models.scheduled_session import ScheduledSession
from app.models.session_occurrence import SessionOccurrence
from app.services.compatibility import parse_custom_weeks
from sqlalchemy.orm import Session as DbSession

STUDY = "STUDY"
RECESS = "RECESS"
FINAL_ASSESSMENT = "FINAL_ASSESSMENT"
TRIMESTER_BREAK = "TRIMESTER_BREAK"

PHASE_LABELS = {
    STUDY: "Study Week",
    RECESS: "Recess Week",
    FINAL_ASSESSMENT: "Final Assessment",
    TRIMESTER_BREAK: "Trimester Break",
}

DAY_OFFSETS = {
    "Monday": 0,
    "Tuesday": 1,
    "Wednesday": 2,
    "Thursday": 3,
    "Friday": 4,
    "Saturday": 5,
    "Sunday": 6,
}

# The three academic years supplied by the user are authoritative.
EXACT_TRIMESTER_STARTS = {
    (2024, 1): date(2024, 9, 2),
    (2024, 2): date(2025, 1, 6),
    (2024, 3): date(2025, 5, 5),
    (2025, 1): date(2025, 9, 1),
    (2025, 2): date(2026, 1, 5),
    (2025, 3): date(2026, 5, 4),
    (2026, 1): date(2026, 8, 31),
    (2026, 2): date(2027, 1, 4),
    (2026, 3): date(2027, 5, 3),
}

# MOM/data.gov.sg public holidays. Weekend dates are retained so academic
# weeks can display the user's ^ marker; observed weekdays are separate rows.
PUBLIC_HOLIDAYS = (
    (date(2024, 1, 1), "New Year's Day", False),
    (date(2024, 2, 10), "Chinese New Year", False),
    (date(2024, 2, 11), "Chinese New Year", False),
    (date(2024, 2, 12), "Chinese New Year (Observed)", True),
    (date(2024, 3, 29), "Good Friday", False),
    (date(2024, 4, 10), "Hari Raya Puasa", False),
    (date(2024, 5, 1), "Labour Day", False),
    (date(2024, 5, 22), "Vesak Day", False),
    (date(2024, 6, 17), "Hari Raya Haji", False),
    (date(2024, 8, 9), "National Day", False),
    (date(2024, 10, 31), "Deepavali", False),
    (date(2024, 12, 25), "Christmas Day", False),
    (date(2025, 1, 1), "New Year's Day", False),
    (date(2025, 1, 29), "Chinese New Year", False),
    (date(2025, 1, 30), "Chinese New Year", False),
    (date(2025, 3, 31), "Hari Raya Puasa", False),
    (date(2025, 4, 18), "Good Friday", False),
    (date(2025, 5, 1), "Labour Day", False),
    (date(2025, 5, 3), "Polling Day", False),
    (date(2025, 5, 12), "Vesak Day", False),
    (date(2025, 6, 7), "Hari Raya Haji", False),
    (date(2025, 8, 9), "National Day", False),
    (date(2025, 10, 20), "Deepavali", False),
    (date(2025, 12, 25), "Christmas Day", False),
    (date(2026, 1, 1), "New Year's Day", False),
    (date(2026, 2, 17), "Chinese New Year", False),
    (date(2026, 2, 18), "Chinese New Year", False),
    (date(2026, 3, 21), "Hari Raya Puasa", False),
    (date(2026, 4, 3), "Good Friday", False),
    (date(2026, 5, 1), "Labour Day", False),
    (date(2026, 5, 27), "Hari Raya Haji", False),
    (date(2026, 5, 31), "Vesak Day", False),
    (date(2026, 6, 1), "Vesak Day (Observed)", True),
    (date(2026, 8, 9), "National Day", False),
    (date(2026, 8, 10), "National Day (Observed)", True),
    (date(2026, 11, 8), "Deepavali", False),
    (date(2026, 11, 9), "Deepavali (Observed)", True),
    (date(2026, 12, 25), "Christmas Day", False),
    (date(2027, 1, 1), "New Year's Day", False),
    (date(2027, 2, 6), "Chinese New Year", False),
    (date(2027, 2, 7), "Chinese New Year", False),
    (date(2027, 2, 8), "Chinese New Year (Observed)", True),
    (date(2027, 3, 10), "Hari Raya Puasa", False),
    (date(2027, 3, 26), "Good Friday", False),
    (date(2027, 5, 1), "Labour Day", False),
    (date(2027, 5, 17), "Hari Raya Haji", False),
    (date(2027, 5, 20), "Vesak Day", False),
    (date(2027, 8, 9), "National Day", False),
    (date(2027, 10, 28), "Deepavali", False),
    (date(2027, 12, 25), "Christmas Day", False),
)


class AcademicCalendarService:
    def seed(self, db: DbSession, through_start_year: int | None = None) -> None:
        today = date.today()
        last_year = through_start_year or today.year + 5
        for start_year in range(2024, last_year + 1):
            self.ensure_academic_year(db, start_year)
        self.seed_public_holidays(db)

    def ensure_academic_year(self, db: DbSession, start_year: int) -> None:
        academic_year = self.academic_year_label(start_year)
        if db.query(AcademicWeek).filter_by(academic_year=academic_year).first():
            return

        starts = self._trimester_starts(start_year)
        next_first = self._trimester_start(start_year + 1, 1)
        boundaries = [starts[1], starts[2], starts[3], next_first]
        is_provisional = start_year not in {2024, 2025, 2026}
        for trimester in (1, 2, 3):
            term_start = boundaries[trimester - 1]
            next_start = boundaries[trimester]
            week_number = 1
            week_start = term_start
            while week_start < next_start:
                db.add(
                    AcademicWeek(
                        academic_year=academic_year,
                        trimester=trimester,
                        week_number=week_number,
                        start_date=week_start,
                        end_date=min(week_start + timedelta(days=6), next_start - timedelta(days=1)),
                        phase=self.phase_for_week(week_number),
                        is_provisional=is_provisional,
                    )
                )
                week_number += 1
                week_start += timedelta(days=7)
        db.flush()

    def seed_public_holidays(self, db: DbSession) -> None:
        existing = {item.date for item in db.query(PublicHoliday.date).all()}
        for holiday_date, name, is_observed in PUBLIC_HOLIDAYS:
            if holiday_date in existing:
                continue
            db.add(
                PublicHoliday(
                    date=holiday_date,
                    name=name,
                    is_observed=is_observed,
                    source="MOM/data.gov.sg",
                )
            )
        db.flush()

    def resolve_date(self, db: DbSession, selected_date: date) -> AcademicWeek:
        start_year = self._academic_start_year(selected_date)
        self.ensure_academic_year(db, start_year)
        week = db.query(AcademicWeek).filter(AcademicWeek.start_date <= selected_date, AcademicWeek.end_date >= selected_date).first()
        if week is None:
            raise ValueError(f"No academic calendar week covers {selected_date.isoformat()}.")
        return week

    def assign_run_calendar(self, db: DbSession, run: ScheduleRun, selected_date: date | None = None) -> AcademicWeek:
        week = self.resolve_date(db, selected_date or date.today())
        run.academic_year = week.academic_year
        run.trimester = week.trimester
        return week

    def assign_run_period(
        self,
        db: DbSession,
        run: ScheduleRun,
        academic_year: str,
        trimester: int,
    ) -> AcademicWeek:
        week = self.period_start(db, academic_year, trimester)
        run.academic_year = week.academic_year
        run.trimester = week.trimester
        return week

    def period_start(self, db: DbSession, academic_year: str, trimester: int) -> AcademicWeek:
        week = db.query(AcademicWeek).filter_by(academic_year=academic_year, trimester=trimester).order_by(AcademicWeek.week_number).first()
        if week is None:
            raise ValueError(f"Academic period {academic_year} Trimester {trimester} was not found.")
        return week

    def next_planning_period(self, db: DbSession, selected_date: date | None = None) -> dict:
        current = self.resolve_date(db, selected_date or date.today())
        if current.trimester < 3:
            academic_year = current.academic_year
            trimester = current.trimester + 1
        else:
            next_start_year = int(current.academic_year.split("/", maxsplit=1)[0]) + 1
            self.ensure_academic_year(db, next_start_year)
            academic_year = self.academic_year_label(next_start_year)
            trimester = 1
        first_week = self.period_start(db, academic_year, trimester)
        return {
            "academic_year": academic_year,
            "trimester": trimester,
            "start_date": first_week.start_date.isoformat(),
            "is_provisional": first_week.is_provisional,
        }

    def sync_run_occurrences(self, db: DbSession, run: ScheduleRun) -> list[SessionOccurrence]:
        if not run.academic_year or not run.trimester:
            created_date = run.created_at.date() if isinstance(run.created_at, datetime) else date.today()
            self.assign_run_calendar(db, run, created_date)

        db.query(SessionOccurrence).filter_by(schedule_run_id=run.id).delete(synchronize_session=False)
        weeks = (
            db.query(AcademicWeek)
            .filter_by(academic_year=run.academic_year, trimester=run.trimester)
            .order_by(AcademicWeek.week_number)
            .all()
        )
        study_weeks = [week for week in weeks if week.phase == STUDY]
        if not study_weeks:
            return []

        first_date = study_weeks[0].start_date
        last_date = study_weeks[-1].end_date
        holidays = {
            item.date: item
            for item in db.query(PublicHoliday).filter(PublicHoliday.date >= first_date, PublicHoliday.date <= last_date).all()
        }
        assignments = (
            db.query(ScheduledSession)
            .filter(
                ScheduledSession.schedule_run_id == run.id,
                ScheduledSession.included_in_final.is_(True),
            )
            .all()
        )
        occurrences = []
        for assignment in assignments:
            day_offset = DAY_OFFSETS.get(assignment.day)
            if day_offset is None:
                continue
            for week in study_weeks:
                if not self._session_occurs_in_week(assignment, week.week_number):
                    continue
                occurrence_date = week.start_date + timedelta(days=day_offset)
                holiday = holidays.get(occurrence_date)
                status = "MAKEUP_REQUIRED" if holiday else "SCHEDULED"
                occurrence = SessionOccurrence(
                    schedule_run_id=run.id,
                    scheduled_session_id=assignment.id,
                    session_id=assignment.session_id,
                    occurrence_date=occurrence_date,
                    academic_year=week.academic_year,
                    trimester=week.trimester,
                    week_number=week.week_number,
                    status=status,
                    reason="Public holiday; make-up session required." if holiday else None,
                    holiday_name=holiday.name if holiday else None,
                )
                db.add(occurrence)
                occurrences.append(occurrence)
        db.flush()
        return occurrences

    def context(self, db: DbSession, selected_date: date, schedule_run_id: int | None = None) -> dict:
        week = self.resolve_date(db, selected_date)
        holidays = (
            db.query(PublicHoliday)
            .filter(PublicHoliday.date >= week.start_date, PublicHoliday.date <= week.end_date)
            .order_by(PublicHoliday.date)
            .all()
        )
        occurrences: list[SessionOccurrence] = []
        if schedule_run_id is not None:
            run = db.query(ScheduleRun).filter_by(id=schedule_run_id).first()
            if run is None:
                raise ValueError("Schedule run not found.")
            if db.query(SessionOccurrence).filter_by(schedule_run_id=run.id).count() == 0:
                self.sync_run_occurrences(db, run)
            occurrences = (
                db.query(SessionOccurrence)
                .filter(
                    SessionOccurrence.schedule_run_id == run.id,
                    SessionOccurrence.occurrence_date >= week.start_date,
                    SessionOccurrence.occurrence_date <= week.end_date,
                )
                .order_by(SessionOccurrence.occurrence_date, SessionOccurrence.id)
                .all()
            )
        return {
            "selected_date": selected_date.isoformat(),
            "week": self.week_to_dict(week, holidays),
            "holidays": [self.holiday_to_dict(item) for item in holidays],
            "occurrences": [self.occurrence_to_dict(item) for item in occurrences],
            "makeup_required_count": sum(item.status == "MAKEUP_REQUIRED" for item in occurrences),
            "lessons_blocked": week.phase != STUDY,
        }

    def week_to_dict(self, week: AcademicWeek, holidays: list[PublicHoliday] | None = None) -> dict:
        holidays = holidays or []
        return {
            "id": week.id,
            "academic_year": week.academic_year,
            "trimester": week.trimester,
            "week_number": week.week_number,
            "start_date": week.start_date.isoformat(),
            "end_date": week.end_date.isoformat(),
            "phase": week.phase,
            "phase_label": PHASE_LABELS.get(week.phase, week.phase.replace("_", " ").title()),
            "is_provisional": week.is_provisional,
            "notes": week.notes,
            "holiday_marker": self.holiday_marker(holidays),
        }

    @staticmethod
    def holiday_to_dict(item: PublicHoliday) -> dict:
        return {
            "id": item.id,
            "date": item.date.isoformat(),
            "name": item.name,
            "day": item.date.strftime("%A"),
            "is_observed": item.is_observed,
            "source": item.source,
            "is_manual_override": item.is_manual_override,
        }

    @staticmethod
    def occurrence_to_dict(item: SessionOccurrence) -> dict:
        return {
            "id": item.id,
            "schedule_run_id": item.schedule_run_id,
            "scheduled_session_id": item.scheduled_session_id,
            "session_id": item.session_id,
            "date": item.occurrence_date.isoformat(),
            "academic_year": item.academic_year,
            "trimester": item.trimester,
            "week_number": item.week_number,
            "status": item.status,
            "reason": item.reason,
            "holiday_name": item.holiday_name,
        }

    @staticmethod
    def holiday_marker(holidays: list[PublicHoliday]) -> str:
        has_caret = any(item.date.weekday() in {0, 5, 6} for item in holidays)
        has_star = any(item.date.weekday() in {1, 2, 3, 4} for item in holidays)
        return ("^" if has_caret else "") + ("*" if has_star else "")

    @staticmethod
    def phase_for_week(week_number: int) -> str:
        if week_number == 7:
            return RECESS
        if week_number == 14:
            return FINAL_ASSESSMENT
        if week_number >= 15:
            return TRIMESTER_BREAK
        return STUDY

    @staticmethod
    def academic_year_label(start_year: int) -> str:
        return f"{start_year}/{str(start_year + 1)[-2:]}"

    def _academic_start_year(self, selected_date: date) -> int:
        current_year_start = self._trimester_start(selected_date.year, 1)
        return selected_date.year if selected_date >= current_year_start else selected_date.year - 1

    def _trimester_starts(self, start_year: int) -> dict[int, date]:
        return {trimester: self._trimester_start(start_year, trimester) for trimester in (1, 2, 3)}

    def _trimester_start(self, start_year: int, trimester: int) -> date:
        exact = EXACT_TRIMESTER_STARTS.get((start_year, trimester))
        if exact:
            return exact
        if trimester == 1:
            return self._closest_monday(date(start_year, 9, 1))
        if trimester == 2:
            return self._first_monday(date(start_year + 1, 1, 1))
        return self._first_monday(date(start_year + 1, 5, 1))

    @staticmethod
    def _closest_monday(target: date) -> date:
        previous = target - timedelta(days=target.weekday())
        following = previous + timedelta(days=7)
        return previous if target - previous <= following - target else following

    @staticmethod
    def _first_monday(target: date) -> date:
        return target + timedelta(days=(-target.weekday()) % 7)

    @staticmethod
    def _session_occurs_in_week(assignment: ScheduledSession, week_number: int) -> bool:
        session = assignment.session
        custom_weeks = set(parse_custom_weeks(session.custom_weeks))
        if custom_weeks:
            return week_number in custom_weeks
        if session.start_week and week_number < session.start_week:
            return False
        if session.end_week and week_number > session.end_week:
            return False
        pattern = (assignment.week_pattern or session.week_pattern or "Weekly").strip().lower()
        if pattern == "odd":
            return week_number % 2 == 1
        if pattern == "even":
            return week_number % 2 == 0
        return True
