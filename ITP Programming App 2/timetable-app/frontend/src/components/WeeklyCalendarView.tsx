import { useMemo, useState } from "react";
import type { ScheduledRow } from "../types";

const allDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const dayKeys = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

type DayName = (typeof allDays)[number];
type DayKey = (typeof dayKeys)[number];

type DisplayOptions = {
  showAmPm: boolean;
  showClassTitle: boolean;
  showInstructors: boolean;
} & Record<DayKey, boolean>;

const defaultDisplayOptions: DisplayOptions = {
  showAmPm: true,
  showClassTitle: true,
  showInstructors: true,
  monday: true,
  tuesday: true,
  wednesday: true,
  thursday: true,
  friday: true,
  saturday: true,
  sunday: true,
};

export default function WeeklyCalendarView({
  rows,
  selectedSessionId,
  onSelectSession,
}: {
  rows: ScheduledRow[];
  selectedSessionId?: number | null;
  onSelectSession?: (sessionId: number) => void;
}) {
  const [weekOf, setWeekOf] = useState(() => formatDateInput(startOfWeek(new Date())));
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("22:00");
  const [displayOptions, setDisplayOptions] = useState<DisplayOptions>(defaultDisplayOptions);

  const weekStart = useMemo(() => startOfWeek(parseDateInput(weekOf) ?? new Date()), [weekOf]);
  const weekDays = useMemo(
    () =>
      allDays.map((day, index) => ({
        day,
        key: dayKeys[index],
        date: addDays(weekStart, index),
      })),
    [weekStart],
  );
  const visibleDays = weekDays.filter((item) => displayOptions[item.key]);
  const timeRows = useMemo(() => buildTimeRows(startTime, endTime), [startTime, endTime]);
  const calendarRows = rows.filter(
    (row) =>
      visibleDays.some((item) => item.day === row.day) &&
      timeToMinutes(row.end_time) > timeToMinutes(startTime) &&
      timeToMinutes(row.start_time) < timeToMinutes(endTime),
  );

  const moveWeek = (direction: -1 | 1) => {
    setWeekOf(formatDateInput(addDays(weekStart, direction * 7)));
  };

  const refreshCalendar = () => {
    setWeekOf(formatDateInput(weekStart));
    if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      setEndTime(minutesToTime(timeToMinutes(startTime) + 60));
    }
  };

  const updateDisplay = (key: keyof DisplayOptions, value: boolean) => {
    setDisplayOptions((current) => ({ ...current, [key]: value }));
  };

  return (
    <section className="week-calendar-card">
      <div className="week-calendar-nav">
        <button className="calendar-button" type="button" onClick={() => moveWeek(-1)}>
          {"<< Previous Week"}
        </button>
        <strong>
          Week of {formatDateDisplay(weekStart)} - {formatDateDisplay(addDays(weekStart, 6))}
        </strong>
        <button className="calendar-button" type="button" onClick={() => moveWeek(1)}>
          {"Next Week >>"}
        </button>
      </div>

      <div className="week-calendar-controls">
        <label>
          <span>Show Week of</span>
          <input type="date" value={weekOf} onChange={(event) => setWeekOf(event.target.value)} />
        </label>
        <label>
          <span>Start Time</span>
          <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
        </label>
        <label>
          <span>End Time</span>
          <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
        </label>
        <button className="calendar-button" type="button" onClick={refreshCalendar}>
          Refresh Calendar
        </button>
      </div>

      <div className="week-calendar-shell">
        <div className="week-calendar-title">Schedule</div>
        <div
          className="week-calendar-grid"
          style={{
            gridTemplateColumns: `76px repeat(${Math.max(visibleDays.length, 1)}, minmax(108px, 1fr))`,
            gridTemplateRows: `42px repeat(${timeRows.length}, 168px)`,
          }}
        >
          <div className="week-calendar-head time-head">Time</div>
          {visibleDays.map((item, index) => (
            <div className="week-calendar-head" key={item.day} style={{ gridColumn: index + 2, gridRow: 1 }}>
              <span>{item.day}</span>
              <small>{formatShortDate(item.date)}</small>
            </div>
          ))}

          {timeRows.map((minutes, rowIndex) => (
            <div className="week-calendar-time" key={minutes} style={{ gridColumn: 1, gridRow: rowIndex + 2 }}>
              {formatTime(minutes, displayOptions.showAmPm)}
            </div>
          ))}

          {visibleDays.map((item, dayIndex) =>
            timeRows.map((minutes, rowIndex) => (
              <div
                className="week-calendar-cell"
                key={`${item.day}-${minutes}`}
                style={{ gridColumn: dayIndex + 2, gridRow: rowIndex + 2 }}
              />
            )),
          )}

          {calendarRows.map((row) => {
            const dayIndex = visibleDays.findIndex((item) => item.day === row.day);
            const start = timeToMinutes(row.start_time);
            const end = timeToMinutes(row.end_time);
            const boundedStart = Math.max(start, timeToMinutes(startTime));
            const boundedEnd = Math.min(end, timeToMinutes(endTime));
            const rowIndex = Math.max(0, Math.floor((boundedStart - timeToMinutes(startTime)) / 60));
            const rowSpan = Math.max(1, Math.ceil((boundedEnd - boundedStart) / 60));
            if (dayIndex < 0 || boundedEnd <= boundedStart) return null;
            return (
              <button
                className={`week-calendar-event ${weekTone(row.week_pattern)} ${selectedSessionId === row.session_id ? "selected" : ""}`}
                key={row.scheduled_session_id}
                onClick={() => onSelectSession?.(row.session_id)}
                style={{
                  gridColumn: dayIndex + 2,
                  gridRow: `${rowIndex + 2} / span ${rowSpan}`,
                }}
                type="button"
              >
                <strong>{eventHeading(row)}</strong>
                {displayOptions.showClassTitle && <span>{row.module_title ?? "Class title not available"}</span>}
                <span>{row.class_type ?? "Class"}</span>
                <span>
                  {formatTime(start, displayOptions.showAmPm)} - {formatTime(end, displayOptions.showAmPm)}
                </span>
                <span>{row.room}</span>
                {displayOptions.showInstructors && (
                  <>
                    <span>Instructors:</span>
                    <span>{row.staff_name ?? row.staff_id ?? "No instructor"}</span>
                  </>
                )}
              </button>
            );
          })}

          {visibleDays.map((item, dayIndex) =>
            timeRows.map((minutes, rowIndex) => {
              const count = calendarRows.filter((row) =>
                row.day === item.day &&
                intervalsOverlap(
                  timeToMinutes(row.start_time),
                  timeToMinutes(row.end_time),
                  minutes,
                  minutes + 60,
                ),
              ).length;
              if (count === 0) return null;
              return (
                <span
                  className="week-calendar-count active"
                  key={`${item.day}-${minutes}-count`}
                  style={{ gridColumn: dayIndex + 2, gridRow: rowIndex + 2 }}
                >
                  {count} {count === 1 ? "session" : "sessions"}
                </span>
              );
            }),
          )}
        </div>
      </div>

      <div className="week-display-options">
        <strong>Display Options</strong>
        <label>
          <input
            type="checkbox"
            checked={displayOptions.showAmPm}
            onChange={(event) => updateDisplay("showAmPm", event.target.checked)}
          />
          Show AM/PM
        </label>
        <label>
          <input
            type="checkbox"
            checked={displayOptions.showClassTitle}
            onChange={(event) => updateDisplay("showClassTitle", event.target.checked)}
          />
          Show Class Title
        </label>
        <label>
          <input
            type="checkbox"
            checked={displayOptions.showInstructors}
            onChange={(event) => updateDisplay("showInstructors", event.target.checked)}
          />
          Show Instructors
        </label>
        {weekDays.map((item) => (
          <label key={item.key}>
            <input
              type="checkbox"
              checked={displayOptions[item.key]}
              onChange={(event) => updateDisplay(item.key, event.target.checked)}
            />
            {item.day}
          </label>
        ))}
        <button className="calendar-button" type="button" onClick={refreshCalendar}>
          Refresh Calendar
        </button>
      </div>
    </section>
  );
}

function startOfWeek(date: Date) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = next.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + offset);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseDateInput(value: string) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateDisplay(date: Date) {
  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
}

function formatShortDate(date: Date) {
  return `${date.getDate()} ${date.toLocaleString(undefined, { month: "short" })}`;
}

function buildTimeRows(startTime: string, endTime: string) {
  const start = timeToMinutes(startTime);
  const end = Math.max(start + 60, timeToMinutes(endTime));
  const rows = [];
  for (let minutes = start; minutes < end; minutes += 60) {
    rows.push(minutes);
  }
  return rows;
}

function timeToMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + (minute || 0);
}

function formatTime(minutes: number, showAmPm: boolean) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  if (!showAmPm) {
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")}${suffix}`;
}

function eventHeading(row: ScheduledRow) {
  const group = row.student_group_code ?? row.programme;
  return group ? `${row.module_code ?? row.requirement_id} - ${group}` : row.module_code ?? row.requirement_id ?? "Session";
}

function intervalsOverlap(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && startB < endA;
}

function minutesToTime(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function weekTone(weekPattern: string | null) {
  const normalized = (weekPattern ?? "Weekly").toLowerCase();
  if (normalized === "odd") return "odd";
  if (normalized === "even") return "even";
  return "weekly";
}
