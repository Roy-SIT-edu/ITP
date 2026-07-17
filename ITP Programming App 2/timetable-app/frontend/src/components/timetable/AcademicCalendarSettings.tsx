import { useEffect, useMemo, useState } from "react";
import {
  createPublicHoliday,
  deletePublicHoliday,
  getAcademicYears,
  getCalendarWeeks,
  getPublicHolidays,
  updateCalendarWeek,
} from "../../api/client";
import type { AcademicWeekInfo, AcademicYearSummary, CalendarHoliday } from "../../types";

type Props = {
  initialAcademicYear?: string | null;
  initialTrimester?: number | null;
};

const phases: AcademicWeekInfo["phase"][] = ["STUDY", "RECESS", "FINAL_ASSESSMENT", "TRIMESTER_BREAK"];

export default function AcademicCalendarSettings({ initialAcademicYear, initialTrimester }: Props) {
  const [years, setYears] = useState<AcademicYearSummary[]>([]);
  const [academicYear, setAcademicYear] = useState(initialAcademicYear ?? "");
  const [trimester, setTrimester] = useState(initialTrimester ?? 1);
  const [weeks, setWeeks] = useState<AcademicWeekInfo[]>([]);
  const [holidays, setHolidays] = useState<CalendarHoliday[]>([]);
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayName, setHolidayName] = useState("");
  const [holidayObserved, setHolidayObserved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void Promise.all([getAcademicYears(), getPublicHolidays()])
      .then(([yearRows, holidayRows]) => {
        setYears(yearRows);
        setHolidays(holidayRows);
        if (!academicYear && yearRows.length) setAcademicYear(yearRows[0].academic_year);
      })
      .catch(() => setMessage("Could not load academic calendar settings."));
  }, [academicYear]);

  useEffect(() => {
    if (!academicYear) return;
    setBusy(true);
    void getCalendarWeeks(academicYear, trimester)
      .then(setWeeks)
      .catch(() => setMessage("Could not load trimester weeks."))
      .finally(() => setBusy(false));
  }, [academicYear, trimester]);

  const trimesterHolidays = useMemo(() => {
    if (!weeks.length) return [];
    const start = weeks[0].start_date;
    const end = weeks[weeks.length - 1].end_date;
    return holidays.filter((holiday) => holiday.date >= start && holiday.date <= end);
  }, [holidays, weeks]);

  function changeWeek(id: number, change: Partial<AcademicWeekInfo>) {
    setWeeks((current) => current.map((week) => (week.id === id ? { ...week, ...change } : week)));
  }

  async function saveWeek(week: AcademicWeekInfo) {
    setBusy(true);
    setMessage("");
    try {
      const updated = await updateCalendarWeek(week.id, week);
      changeWeek(week.id, updated);
      setMessage(`Week ${week.week_number} saved.`);
    } catch {
      setMessage(`Could not save week ${week.week_number}. Check that its dates are valid.`);
    } finally {
      setBusy(false);
    }
  }

  async function addHoliday() {
    if (!holidayDate || !holidayName.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const holiday = await createPublicHoliday({
        date: holidayDate,
        name: holidayName.trim(),
        is_observed: holidayObserved,
      });
      setHolidays((current) => [...current, holiday].sort((a, b) => a.date.localeCompare(b.date)));
      setHolidayDate("");
      setHolidayName("");
      setHolidayObserved(false);
      setMessage("Public holiday added. Affected lessons will require make-up sessions.");
    } catch {
      setMessage("Could not add the holiday. That date may already be listed.");
    } finally {
      setBusy(false);
    }
  }

  async function removeHoliday(holiday: CalendarHoliday) {
    setBusy(true);
    setMessage("");
    try {
      await deletePublicHoliday(holiday.id);
      setHolidays((current) => current.filter((item) => item.id !== holiday.id));
      setMessage(`${holiday.name} removed.`);
    } catch {
      setMessage("Could not remove the holiday.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="academic-calendar-settings">
      <summary>Academic calendar settings</summary>
      <p className="muted-text">
        Future years are generated provisionally. Edit dates or phases here; recess, assessment, and break weeks block
        lessons.
      </p>
      <div className="academic-calendar-controls">
        <label>
          Academic year
          <select value={academicYear} onChange={(event) => setAcademicYear(event.target.value)}>
            {years.map((year) => (
              <option key={year.academic_year} value={year.academic_year}>
                {year.academic_year}
                {year.is_provisional ? " (Provisional)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Trimester
          <select value={trimester} onChange={(event) => setTrimester(Number(event.target.value))}>
            <option value={1}>Trimester 1</option>
            <option value={2}>Trimester 2</option>
            <option value={3}>Trimester 3</option>
          </select>
        </label>
      </div>

      <div className="academic-week-list" aria-busy={busy}>
        {weeks.map((week) => (
          <div className="academic-week-row" key={week.id}>
            <strong>W{week.week_number}</strong>
            <input
              aria-label={`Week ${week.week_number} start date`}
              type="date"
              value={week.start_date}
              onChange={(event) => changeWeek(week.id, { start_date: event.target.value })}
            />
            <input
              aria-label={`Week ${week.week_number} end date`}
              type="date"
              value={week.end_date}
              onChange={(event) => changeWeek(week.id, { end_date: event.target.value })}
            />
            <select
              aria-label={`Week ${week.week_number} phase`}
              value={week.phase}
              onChange={(event) => changeWeek(week.id, { phase: event.target.value as AcademicWeekInfo["phase"] })}
            >
              {phases.map((phase) => (
                <option key={phase} value={phase}>
                  {phase.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <label className="academic-week-provisional">
              <input
                type="checkbox"
                checked={week.is_provisional}
                onChange={(event) => changeWeek(week.id, { is_provisional: event.target.checked })}
              />
              Provisional
            </label>
            <button className="button secondary slim" disabled={busy} onClick={() => void saveWeek(week)} type="button">
              Save
            </button>
          </div>
        ))}
      </div>

      <h4>Public holidays in this trimester</h4>
      <div className="academic-holiday-form">
        <input
          aria-label="Holiday date"
          type="date"
          value={holidayDate}
          onChange={(e) => setHolidayDate(e.target.value)}
        />
        <input
          aria-label="Holiday name"
          placeholder="Holiday name"
          value={holidayName}
          onChange={(event) => setHolidayName(event.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={holidayObserved}
            onChange={(event) => setHolidayObserved(event.target.checked)}
          />
          Observed date
        </label>
        <button
          className="button slim"
          disabled={busy || !holidayDate || !holidayName.trim()}
          onClick={() => void addHoliday()}
          type="button"
        >
          Add holiday
        </button>
      </div>
      <div className="academic-holiday-list">
        {trimesterHolidays.map((holiday) => (
          <div key={holiday.id}>
            <span>
              <strong>{holiday.date}</strong> {holiday.name}
              {holiday.is_observed ? " (Observed)" : ""}
            </span>
            <button
              className="button secondary slim"
              disabled={busy}
              onClick={() => void removeHoliday(holiday)}
              type="button"
            >
              Remove
            </button>
          </div>
        ))}
        {!trimesterHolidays.length && <span className="muted-text">No public holidays in this trimester.</span>}
      </div>
      {message && <p className="academic-calendar-message">{message}</p>}
    </details>
  );
}
