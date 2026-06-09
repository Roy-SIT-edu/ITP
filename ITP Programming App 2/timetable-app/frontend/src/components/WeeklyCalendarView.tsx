import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ResolutionSuggestion, ScheduledRow } from "../types";

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
  previewMove,
  onSelectSession,
}: {
  rows: ScheduledRow[];
  selectedSessionId?: number | null;
  previewMove?: ResolutionSuggestion | null;
  onSelectSession?: (sessionId: number) => void;
}) {
  const [weekOf, setWeekOf] = useState(() => formatDateInput(startOfWeek(new Date())));
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("22:00");
  const [displayOptions, setDisplayOptions] = useState<DisplayOptions>(defaultDisplayOptions);
  const [activeCellKey, setActiveCellKey] = useState<string | null>(null);

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
  const visibleDays = useMemo(() => weekDays.filter((item) => displayOptions[item.key]), [displayOptions, weekDays]);
  const timeRows = useMemo(() => buildTimeRows(startTime, endTime), [startTime, endTime]);
  const calendarRows = rows.filter(
    (row) =>
      visibleDays.some((item) => item.day === row.day) &&
      timeToMinutes(row.end_time) > timeToMinutes(startTime) &&
      timeToMinutes(row.start_time) < timeToMinutes(endTime),
  );
  const rowsByCell = useMemo(() => {
    const grouped = new Map<string, ScheduledRow[]>();
    visibleDays.forEach((item) => {
      timeRows.forEach((minutes) => {
        const cellRows = calendarRows
          .filter(
            (row) =>
              row.day === item.day &&
              intervalsOverlap(
                timeToMinutes(row.start_time),
                timeToMinutes(row.end_time),
                minutes,
                minutes + 60,
              ),
          )
          .sort(compareCalendarRows);
        if (cellRows.length) {
          grouped.set(calendarCellKey(item.day, minutes), cellRows);
        }
      });
    });
    return grouped;
  }, [calendarRows, timeRows, visibleDays]);
  const activeCell = useMemo(() => {
    if (!activeCellKey) return null;
    const [day, minuteValue] = activeCellKey.split("|");
    const minutes = Number(minuteValue);
    const dayIndex = visibleDays.findIndex((item) => item.day === day);
    const rowIndex = timeRows.indexOf(minutes);
    if (dayIndex < 0 || rowIndex < 0) return null;
    return {
      day,
      minutes,
      dayIndex,
      rowIndex,
      rows: rowsByCell.get(activeCellKey) ?? [],
    };
  }, [activeCellKey, rowsByCell, timeRows, visibleDays]);

  useEffect(() => {
    if (activeCellKey && !rowsByCell.has(activeCellKey)) {
      setActiveCellKey(null);
    }
  }, [activeCellKey, rowsByCell]);

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

  const selectCell = (key: string, cellRows: ScheduledRow[]) => {
    if (cellRows.length === 0) {
      setActiveCellKey(null);
      return;
    }
    setActiveCellKey(key);
  };

  const selectSessionFromPopover = (sessionId: number) => {
    onSelectSession?.(sessionId);
    setActiveCellKey(null);
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
            timeRows.map((minutes, rowIndex) => {
              const key = calendarCellKey(item.day, minutes);
              const cellRows = rowsByCell.get(key) ?? [];
              const count = cellRows.length;
              const containsSelected = selectedSessionId != null && cellRows.some((row) => row.session_id === selectedSessionId);
              const containsPreview =
                !!previewMove &&
                previewMove.day === item.day &&
                intervalsOverlap(
                  timeToMinutes(previewMove.start_time),
                  timeToMinutes(previewMove.end_time),
                  minutes,
                  minutes + 60,
                );
              const active = activeCellKey === key;
              return (
                <button
                  aria-label={cellAriaLabel(item.day, minutes, count)}
                  className={`week-calendar-cell ${densityClass(count)} ${active ? "active" : ""} ${containsSelected ? "contains-selected" : ""} ${containsPreview ? "has-preview" : ""}`}
                  disabled={count === 0 && !containsPreview}
                  key={key}
                  onClick={() => selectCell(key, cellRows)}
                  style={{ gridColumn: dayIndex + 2, gridRow: rowIndex + 2 }}
                  type="button"
                >
                  {containsPreview && (
                    <span className="week-calendar-ghost-card">
                      <strong>Preview move</strong>
                      <small>{previewMove.start_time}-{previewMove.end_time} | {previewMove.room_code}</small>
                    </span>
                  )}
                  {count > 0 && (
                    <>
                      <span className="week-calendar-cell-topline">
                        <span className="week-calendar-density-pill">+{count}</span>
                      </span>
                      <span className="week-calendar-program-strip">
                        {programPreview(cellRows).map((programme) => (
                          <span className="week-calendar-program-chip" key={programme}>
                            {programme}
                          </span>
                        ))}
                      </span>
                      <span className="week-calendar-hover-card" aria-hidden="true">
                        <span className="week-calendar-hover-head">
                          {formatTime(minutes, displayOptions.showAmPm)}-{formatTime(minutes + 60, displayOptions.showAmPm)}
                        </span>
                        <span className="week-calendar-hover-list">
                          {cellRows.map((row) => (
                            <span className="week-calendar-hover-row" key={row.scheduled_session_id}>
                              <span>
                                <strong>{row.module_code ?? row.requirement_id ?? "Session"}</strong>
                                <em>{shortClassType(row.class_type)}</em>
                              </span>
                              <small>
                                {row.programme ?? "No programme"} | {instructorLastName(row.staff_name ?? row.staff_id)}
                              </small>
                            </span>
                          ))}
                        </span>
                      </span>
                    </>
                  )}
                </button>
              );
            }),
          )}

          {activeCell && activeCell.rows.length > 0 && (
            <div
              className="week-calendar-popover"
              style={{
                gridColumn: `${activeCell.dayIndex + 2} / span ${activeCell.dayIndex >= visibleDays.length - 1 ? 1 : 2}`,
                gridRow: activeCell.rowIndex + 2,
              }}
            >
              <div className="week-calendar-popover-head">
                <div>
                  <strong>
                    {activeCell.day}, {formatTime(activeCell.minutes, displayOptions.showAmPm)}-
                    {formatTime(activeCell.minutes + 60, displayOptions.showAmPm)}
                  </strong>
                  <span>{activeCell.rows.length} {activeCell.rows.length === 1 ? "session" : "sessions"}</span>
                </div>
                <button aria-label="Close session list" className="icon-button" type="button" onClick={() => setActiveCellKey(null)}>
                  <X size={14} />
                </button>
              </div>
              <div className="week-calendar-popover-list">
                {activeCell.rows.map((row) => (
                  <button
                    className={`week-calendar-mini-card ${selectedSessionId === row.session_id ? "active" : ""}`}
                    key={row.scheduled_session_id}
                    onClick={() => selectSessionFromPopover(row.session_id)}
                    type="button"
                  >
                    <span className="mini-card-title">
                      <strong>{row.module_code ?? row.requirement_id ?? "Session"}</strong>
                      <span className="mini-session-tag">{shortClassType(row.class_type)}</span>
                    </span>
                    {displayOptions.showClassTitle && <small>{row.module_title ?? "Class title not available"}</small>}
                    {displayOptions.showInstructors && <span>{instructorLastName(row.staff_name ?? row.staff_id)}</span>}
                    <span>
                      {row.student_group_code ?? row.programme ?? "No group"} | {row.room} | {row.start_time}-{row.end_time}
                    </span>
                    <span>
                      {row.week_pattern ?? "Weeks not set"} | {row.delivery_mode ?? "Mode not set"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
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

function calendarCellKey(day: DayName | string, minutes: number) {
  return `${day}|${minutes}`;
}

function cellAriaLabel(day: DayName | string, minutes: number, count: number) {
  const label = `${day} ${minutesToTime(minutes)}-${minutesToTime(minutes + 60)}`;
  if (count === 0) return `${label}, no sessions`;
  return `${label}, ${count} ${count === 1 ? "session" : "sessions"}`;
}

function compareCalendarRows(left: ScheduledRow, right: ScheduledRow) {
  return (
    timeToMinutes(left.start_time) - timeToMinutes(right.start_time) ||
    (left.module_code ?? left.requirement_id ?? "").localeCompare(right.module_code ?? right.requirement_id ?? "")
  );
}

function densityClass(count: number) {
  if (count === 0) return "empty";
  if (count === 1) return "load-1";
  if (count === 2) return "load-2";
  if (count <= 4) return "load-4";
  return "load-5";
}

function shortClassType(value: string | null) {
  const text = (value ?? "Class").trim();
  const normalized = text.toLowerCase();
  if (normalized.includes("lecture")) return "Lec";
  if (normalized.includes("tutorial")) return "Tut";
  if (normalized.includes("lab")) return "Lab";
  if (normalized.includes("seminar")) return "Sem";
  if (normalized.includes("workshop")) return "Wrk";
  return text.slice(0, 4) || "Class";
}

function instructorLastName(value: string | null) {
  const text = (value ?? "").trim();
  if (!text) return "No instructor";
  const parts = text.split(/\s+/);
  return parts[parts.length - 1];
}

function programPreview(rows: ScheduledRow[]) {
  const programmes = Array.from(new Set(rows.map((row) => row.programme).filter(Boolean).map(String)));
  if (programmes.length <= 2) return programmes;
  return [...programmes.slice(0, 2), `+${programmes.length - 2}`];
}
