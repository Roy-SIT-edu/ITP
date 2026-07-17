"""Tests for rolling academic calendars, blocked weeks, and holidays."""

from datetime import date, timedelta

from app.models.academic_week import AcademicWeek
from app.models.room import Room
from app.models.schedule_run import ScheduleRun
from app.models.scheduled_session import ScheduledSession
from app.models.session import Session
from app.models.session_occurrence import SessionOccurrence
from app.models.time_slot import TimeSlot
from app.services.academic_calendar_service import AcademicCalendarService


def test_supplied_calendar_dates_and_phases_are_seeded(db_session):
    service = AcademicCalendarService()

    week_one = service.resolve_date(db_session, date(2026, 5, 4))
    recess = service.resolve_date(db_session, date(2026, 6, 15))
    assessment = service.resolve_date(db_session, date(2026, 8, 3))
    break_week = service.resolve_date(db_session, date(2026, 8, 10))

    assert (week_one.academic_year, week_one.trimester, week_one.week_number, week_one.phase) == (
        "2025/26",
        3,
        1,
        "STUDY",
    )
    assert (recess.week_number, recess.phase) == (7, "RECESS")
    assert (assessment.week_number, assessment.phase) == (14, "FINAL_ASSESSMENT")
    assert (break_week.week_number, break_week.phase) == (15, "TRIMESTER_BREAK")


def test_holiday_markers_follow_supplied_caret_and_star_meanings(db_session):
    service = AcademicCalendarService()

    caret_context = service.context(db_session, date(2026, 6, 1))
    star_context = service.context(db_session, date(2026, 5, 27))

    assert caret_context["week"]["holiday_marker"] == "^"
    assert star_context["week"]["holiday_marker"] == "^*"


def test_future_calendar_is_generated_as_provisional(db_session):
    service = AcademicCalendarService()

    week = service.resolve_date(db_session, date(2031, 9, 1))

    assert week.academic_year == "2031/32"
    assert week.trimester == 1
    assert week.week_number == 1
    assert week.start_date == date(2031, 9, 1)
    assert week.is_provisional is True


def test_next_planning_period_rolls_from_trimester_three_to_next_academic_year(db_session):
    period = AcademicCalendarService().next_planning_period(db_session, date(2026, 7, 17))

    assert period == {
        "academic_year": "2026/27",
        "trimester": 1,
        "start_date": "2026-08-31",
        "is_provisional": False,
    }


def test_selected_planning_period_is_assigned_to_schedule_run(db_session):
    run = ScheduleRun(status="RUNNING")
    db_session.add(run)

    week = AcademicCalendarService().assign_run_period(db_session, run, "2026/27", 2)

    assert (run.academic_year, run.trimester) == ("2026/27", 2)
    assert week.start_date == date(2027, 1, 4)


def test_occurrences_skip_non_teaching_weeks_and_flag_holidays(db_session):
    session = db_session.query(Session).filter_by(requirement_id="REQ-DEMO-001").one()
    session.start_week = 1
    session.end_week = 13
    session.week_pattern = "Weekly"
    slot = (
        db_session.query(TimeSlot)
        .filter_by(
            day="Monday",
            start_time="09:00",
            end_time="11:00",
            week_pattern="Weekly",
        )
        .one()
    )
    room = db_session.query(Room).filter_by(room_code="SR-01").one()
    run = ScheduleRun(status="COMPLETED", academic_year="2025/26", trimester=3)
    db_session.add(run)
    db_session.flush()
    assignment = ScheduledSession(
        schedule_run_id=run.id,
        session_id=session.id,
        room_id=room.id,
        time_slot_id=slot.id,
        staff_id=session.staff_id,
        day=slot.day,
        start_time=slot.start_time,
        end_time=slot.end_time,
        week_pattern=slot.week_pattern,
    )
    db_session.add(assignment)
    db_session.flush()

    AcademicCalendarService().sync_run_occurrences(db_session, run)
    occurrences = db_session.query(SessionOccurrence).filter_by(schedule_run_id=run.id).all()
    by_date = {item.occurrence_date: item for item in occurrences}

    assert by_date[date(2026, 5, 4)].status == "SCHEDULED"
    assert by_date[date(2026, 6, 1)].status == "MAKEUP_REQUIRED"
    assert by_date[date(2026, 6, 1)].holiday_name == "Vesak Day (Observed)"
    assert date(2026, 6, 15) not in by_date
    assert {item.week_number for item in occurrences}.isdisjoint({7, 14, 15})


def test_context_blocks_recess_assessment_and_break_weeks(db_session):
    service = AcademicCalendarService()

    for selected_date in (date(2026, 6, 15), date(2026, 8, 3), date(2026, 8, 10)):
        assert service.context(db_session, selected_date)["lessons_blocked"] is True

    study_context = service.context(db_session, date(2026, 6, 8))
    assert study_context["lessons_blocked"] is False


def test_calendar_week_records_cover_each_date_without_gaps(db_session):
    rows = db_session.query(AcademicWeek).filter_by(academic_year="2026/27").order_by(AcademicWeek.start_date).all()

    assert rows[0].start_date == date(2026, 8, 31)
    for previous, current in zip(rows, rows[1:]):
        assert current.start_date == previous.end_date + timedelta(days=1)
