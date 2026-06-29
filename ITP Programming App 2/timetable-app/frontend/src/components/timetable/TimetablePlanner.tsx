import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import type { ScheduledRow } from "../../types";
import { days, type MoveDraft, type PlannerSlot } from "./types";
import { getFirstOverlapKey, intervalsOverlap, timeToMinutes } from "./timetableUtils";

type Props = {
  rows?: ScheduledRow[];
  slots: PlannerSlot[];
  grouped: Map<string, ScheduledRow[]>;
  weekStart?: Date;
  weekNumber?: number;
  displayStartTime?: string;
  displayEndTime?: string;
  onPreviousWeek?: () => void;
  onNextWeek?: () => void;
  onWeekDateChange?: (value: string) => void;
  onDisplayStartTimeChange?: (value: string) => void;
  onDisplayEndTimeChange?: (value: string) => void;
  onRefresh?: () => void;
  selectedSlotKey?: string | null;
  isPlacing?: boolean;
  selectedSessionDraft?: MoveDraft;
  onSelectSlot?: (key: string, rows: ScheduledRow[]) => void;
  conflictSlotKeys?: Set<string>;
  availableSlotKeys?: Set<string>;
};

const HOUR_HEIGHT = 54;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function TimetablePlanner({
  rows = [],
  slots,
  grouped,
  weekStart,
  weekNumber,
  displayStartTime = "08:00",
  displayEndTime = "22:00",
  onPreviousWeek,
  onNextWeek,
  onWeekDateChange,
  onDisplayStartTimeChange,
  onDisplayEndTimeChange,
  onRefresh,
  selectedSlotKey,
  isPlacing,
  selectedSessionDraft,
  onSelectSlot,
  conflictSlotKeys = new Set(),
  availableSlotKeys = new Set(),
}: Props) {
  const safeWeekStart = weekStart ?? startOfWeek(new Date());
  const [showAmPm, setShowAmPm] = useState(true);
  const [showClassTitle, setShowClassTitle] = useState(true);
  const [showInstructors, setShowInstructors] = useState(false);
  const [visibleDays, setVisibleDays] = useState(days);
  const displayDays = days.filter((day) => visibleDays.includes(day));
  const rangeStart = slots[0] ? timeToMinutes(slots[0].start_time) : timeToMinutes(displayStartTime);
  const rangeEnd = slots[slots.length - 1]
    ? timeToMinutes(slots[slots.length - 1].end_time)
    : timeToMinutes(displayEndTime);
  const calendarHeight = Math.max(HOUR_HEIGHT, ((rangeEnd - rangeStart) / 60) * HOUR_HEIGHT);
  const dayHeadings = displayDays.map((day) => ({
    day,
    date: addDays(safeWeekStart, days.indexOf(day)),
  }));
  const events = useMemo(
    () => layoutEvents(rows, displayDays, rangeStart, rangeEnd, slots),
    [displayDays, rangeEnd, rangeStart, rows, slots],
  );

  const updateStartTime = (value: string) => {
    onDisplayStartTimeChange?.(value);
    if (timeToMinutes(value) >= timeToMinutes(displayEndTime)) {
      onDisplayEndTimeChange?.(nextHour(value));
    }
  };

  const updateEndTime = (value: string) => {
    onDisplayEndTimeChange?.(value);
    if (timeToMinutes(value) <= timeToMinutes(displayStartTime)) {
      onDisplayStartTimeChange?.(previousHour(value));
    }
  };

  const toggleDay = (day: string) => {
    setVisibleDays((current) => {
      if (current.includes(day)) {
        return current.length > 1 ? current.filter((item) => item !== day) : current;
      }
      return days.filter((item) => item === day || current.includes(item));
    });
  };

  return (
    <div className="planner-shell calendar-shell">
      <div className="calendar-week-toolbar">
        <button className="button secondary slim" onClick={onPreviousWeek} type="button">
          <ChevronLeft size={16} />
          Previous Week
        </button>
        <div className="calendar-week-title">
          <strong>Week of {formatDateRange(safeWeekStart)}</strong>
          <span>Academic week {weekNumber ?? 1}</span>
        </div>
        <button className="button secondary slim" onClick={onNextWeek} type="button">
          Next Week
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="calendar-control-bar">
        <label>
          <span>Show Week Of</span>
          <div className="calendar-date-input">
            <input
              type="date"
              value={toDateInput(safeWeekStart)}
              onChange={(event) => onWeekDateChange?.(event.target.value)}
            />
            <CalendarDays size={16} />
          </div>
        </label>
        <label>
          <span>Start Time</span>
          <select value={displayStartTime} onChange={(event) => updateStartTime(event.target.value)}>
            {timeOptions(6, 22).map((time) => (
              <option key={time} value={time}>
                {formatTime(time, showAmPm)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>End Time</span>
          <select value={displayEndTime} onChange={(event) => updateEndTime(event.target.value)}>
            {timeOptions(7, 23).map((time) => (
              <option key={time} value={time}>
                {formatTime(time, showAmPm)}
              </option>
            ))}
          </select>
        </label>
        <button className="button secondary slim" onClick={onRefresh} type="button">
          <RefreshCw size={16} />
          Refresh Calendar
        </button>
      </div>

      <div
        className="calendar-board"
        role="grid"
        aria-label="Weekly timetable calendar"
        style={{ gridTemplateColumns: `74px repeat(${dayHeadings.length}, minmax(112px, 1fr))` }}
      >
        <div className="calendar-corner">Time</div>
        {dayHeadings.map(({ day, date }) => (
          <div className="calendar-day-heading" key={day}>
            <strong>{day}</strong>
            <span>
              {date.getDate()} {MONTHS[date.getMonth()]}
            </span>
          </div>
        ))}

        <div className="calendar-time-rail" style={{ height: calendarHeight }}>
          {slots.map((slot) => (
            <div className="calendar-time-label" key={slot.key} style={{ height: HOUR_HEIGHT }}>
              {formatTime(slot.start_time, showAmPm)}
            </div>
          ))}
        </div>

        {dayHeadings.map(({ day }) => (
          <div className="calendar-day-column" key={day} style={{ height: calendarHeight }}>
            {slots.map((slot) => {
              const key = `${day}|${slot.start_time}|${slot.end_time}`;
              const slotRows = grouped.get(key) ?? [];
              const selected = key === selectedSlotKey;
              const isConflictCell = conflictSlotKeys.has(key);
              const isAvailableCell = availableSlotKeys.has(key);
              const draftSelected =
                selectedSessionDraft?.day === day &&
                Boolean(selectedSessionDraft.start_time) &&
                Boolean(selectedSessionDraft.end_time) &&
                intervalsOverlap(
                  slot.start_time,
                  slot.end_time,
                  selectedSessionDraft.start_time,
                  selectedSessionDraft.end_time,
                );
              return (
                <button
                  aria-label={`${day} ${formatTime(slot.start_time, showAmPm)} slot`}
                  className={`calendar-slot ${slotRows.length ? "busy" : "empty"} ${selected ? "selected" : ""} ${
                    isPlacing ? "placing-mode" : ""
                  } ${draftSelected ? "highlight-draft" : ""} ${isConflictCell ? "conflict-current" : ""} ${
                    isAvailableCell ? "conflict-available" : ""
                  }`}
                  disabled={!slotRows.length && !onSelectSlot && !isPlacing}
                  key={key}
                  onClick={() => onSelectSlot?.(key, slotRows)}
                  style={{ height: HOUR_HEIGHT }}
                  type="button"
                />
              );
            })}

            {events
              .filter((event) => event.row.day === day)
              .map((event) => {
                const firstKey = getFirstOverlapKey(event.row, slots);
                const slotRows = grouped.get(firstKey) ?? [event.row];
                const hasConflict = event.slotKeys.some((key) => conflictSlotKeys.has(key));
                const isSelected = event.slotKeys.some((key) => key === selectedSlotKey);
                return (
                  <button
                    className={`calendar-event ${hasConflict ? "conflict-current" : ""} ${
                      isSelected ? "selected" : ""
                    }`}
                    disabled={!onSelectSlot}
                    key={event.row.scheduled_session_id}
                    onClick={() => onSelectSlot?.(firstKey, slotRows)}
                    style={event.style}
                    type="button"
                  >
                    <strong>
                      {event.row.module_code ?? event.row.requirement_id ?? `Session ${event.row.session_id}`}
                    </strong>
                    {showClassTitle && (
                      <span>
                        {[event.row.student_group_code, event.row.class_type].filter(Boolean).join(" - ") || "Class"}
                      </span>
                    )}
                    <span>
                      {formatTime(event.row.start_time, showAmPm)} - {formatTime(event.row.end_time, showAmPm)}
                    </span>
                    <span>{event.row.delivery_mode === "Online" ? "Online" : event.row.room}</span>
                    {showInstructors && (
                      <small>{event.row.co_teacher_names || event.row.staff_name || "No instructor"}</small>
                    )}
                  </button>
                );
              })}
          </div>
        ))}
      </div>

      <div className="calendar-options-panel">
        <div className="calendar-options-title">Display Options</div>
        <div className="calendar-option-grid">
          <label>
            <input checked={showAmPm} onChange={(event) => setShowAmPm(event.target.checked)} type="checkbox" />
            Show AM/PM
          </label>
          <label>
            <input
              checked={showClassTitle}
              onChange={(event) => setShowClassTitle(event.target.checked)}
              type="checkbox"
            />
            Show Class Title
          </label>
          <label>
            <input
              checked={showInstructors}
              onChange={(event) => setShowInstructors(event.target.checked)}
              type="checkbox"
            />
            Show Instructors
          </label>
          {days.map((day) => (
            <label key={day}>
              <input checked={visibleDays.includes(day)} onChange={() => toggleDay(day)} type="checkbox" />
              {day}
            </label>
          ))}
          <button className="button secondary slim" onClick={onRefresh} type="button">
            <RefreshCw size={16} />
            Refresh Calendar
          </button>
        </div>
      </div>
    </div>
  );
}

function layoutEvents(
  rows: ScheduledRow[],
  displayDays: string[],
  rangeStart: number,
  rangeEnd: number,
  slots: PlannerSlot[],
) {
  const byDay = new Map<string, ScheduledRow[]>();
  for (const row of rows) {
    if (!displayDays.includes(row.day)) continue;
    if (!intervalsOverlap(row.start_time, row.end_time, minutesToTime(rangeStart), minutesToTime(rangeEnd))) continue;
    byDay.set(row.day, [...(byDay.get(row.day) ?? []), row]);
  }

  return Array.from(byDay.entries()).flatMap(([, dayRows]) => {
    const lanes: number[] = [];
    const assigned = dayRows
      .slice()
      .sort((left, right) => timeToMinutes(left.start_time) - timeToMinutes(right.start_time))
      .map((row) => {
        const start = Math.max(timeToMinutes(row.start_time), rangeStart);
        const end = Math.min(timeToMinutes(row.end_time), rangeEnd);
        const lane = lanes.findIndex((laneEnd) => laneEnd <= start);
        const nextLane = lane >= 0 ? lane : lanes.length;
        lanes[nextLane] = end;
        return { row, start, end, lane: nextLane };
      });

    const laneCount = Math.max(1, lanes.length);
    return assigned.map(({ row, start, end, lane }) => {
      const width = 100 / laneCount;
      const left = width * lane;
      const slotKeys = slots
        .filter((slot) => intervalsOverlap(row.start_time, row.end_time, slot.start_time, slot.end_time))
        .map((slot) => `${row.day}|${slot.start_time}|${slot.end_time}`);
      return {
        row,
        slotKeys,
        style: {
          height: Math.max(30, ((end - start) / 60) * HOUR_HEIGHT - 4),
          left: `calc(${left}% + 3px)`,
          top: ((start - rangeStart) / 60) * HOUR_HEIGHT + 2,
          width: `calc(${width}% - 6px)`,
        } satisfies CSSProperties,
      };
    });
  });
}

function startOfWeek(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  const offset = (next.getDay() + 6) % 7;
  next.setDate(next.getDate() - offset);
  return next;
}

function addDays(date: Date, daysToAdd: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + daysToAdd);
  return next;
}

function toDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateRange(start: Date) {
  const end = addDays(start, 6);
  return `${formatDate(start)} - ${formatDate(end)}`;
}

function formatDate(date: Date) {
  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
}

function formatTime(time: string, showAmPm: boolean) {
  if (!showAmPm) return time;
  const minutes = timeToMinutes(time);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")}${period}`;
}

function timeOptions(startHour: number, endHour: number) {
  const options = [];
  for (let hour = startHour; hour <= endHour; hour += 1) {
    options.push(`${String(hour).padStart(2, "0")}:00`);
  }
  return options;
}

function nextHour(time: string) {
  const minutes = Math.min(23 * 60, timeToMinutes(time) + 60);
  return minutesToTime(minutes);
}

function previousHour(time: string) {
  const minutes = Math.max(0, timeToMinutes(time) - 60);
  return minutesToTime(minutes);
}

function minutesToTime(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
