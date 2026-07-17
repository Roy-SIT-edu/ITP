import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { AcademicCalendarContext, ScheduledRow } from "../../types";
import { days, type MoveDraft, type PlannerSlot, type TimetableIssueTone } from "./types";
import { getFirstOverlapKey, intervalsOverlap, timeToMinutes } from "./timetableUtils";
import { SCHEDULING_DAY_END_HOUR, SCHEDULING_DAY_END_TIME } from "../../schedulingHours";

type Props = {
  rows?: ScheduledRow[];
  slots: PlannerSlot[];
  grouped: Map<string, ScheduledRow[]>;
  weekStart?: Date;
  weekNumber?: number;
  calendarContext?: AcademicCalendarContext | null;
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
  onSelectSlot?: (key: string, rows: ScheduledRow[], options?: { focusSlotDetails?: boolean }) => void;
  conflictSlotKeys?: Set<string>;
  availableSlotKeys?: Set<string>;
  softAvailableSlotKeys?: Set<string>;
  blockedSlotKeys?: Set<string>;
  issueToneBySessionId?: Map<number, TimetableIssueTone>;
};

const HOUR_HEIGHT = 64;
const MAX_DETAILED_LANES = 2;
const MAX_DETAILED_EVENTS_PER_SLOT = 2;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type CalendarEventDensity = "normal" | "short" | "compact";

type CalendarLayoutItem =
  | {
      kind: "event";
      day: string;
      row: ScheduledRow;
      slotKeys: string[];
      style: CSSProperties;
      density: CalendarEventDensity;
    }
  | {
      kind: "cluster";
      day: string;
      id: string;
      rows: ScheduledRow[];
      start: number;
      end: number;
      slotKeys: string[];
      style: CSSProperties;
    };

export default function TimetablePlanner({
  rows = [],
  slots,
  grouped,
  weekStart,
  weekNumber,
  calendarContext,
  displayStartTime = "08:00",
  displayEndTime = SCHEDULING_DAY_END_TIME,
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
  softAvailableSlotKeys = new Set(),
  blockedSlotKeys = new Set(),
  issueToneBySessionId = new Map(),
}: Props) {
  const safeWeekStart = weekStart ?? startOfWeek(new Date());
  const [showAmPm, setShowAmPm] = useState(true);
  const [showClassTitle, setShowClassTitle] = useState(true);
  const [showInstructors, setShowInstructors] = useState(false);
  const defaultVisibleDays = useMemo(() => days.slice(), []);
  const [visibleDays, setVisibleDays] = useState(defaultVisibleDays);
  const [daySelectionTouched, setDaySelectionTouched] = useState(false);
  const displayDays = days.filter((day) => visibleDays.includes(day));
  const rangeStart = slots[0] ? timeToMinutes(slots[0].start_time) : timeToMinutes(displayStartTime);
  const rangeEnd = slots[slots.length - 1]
    ? timeToMinutes(slots[slots.length - 1].end_time)
    : timeToMinutes(displayEndTime);
  const terminalTime = slots[slots.length - 1]?.end_time ?? displayEndTime;
  const calendarHeight = Math.max(HOUR_HEIGHT, ((rangeEnd - rangeStart) / 60) * HOUR_HEIGHT);
  const dayHeadings = displayDays.map((day) => {
    const date = addDays(safeWeekStart, days.indexOf(day));
    return {
      day,
      date,
      holiday: calendarContext?.holidays.find((item) => item.date === toDateInput(date)) ?? null,
    };
  });
  const events = useMemo(
    () => layoutEvents(rows, displayDays, rangeStart, rangeEnd, slots),
    [displayDays, rangeEnd, rangeStart, rows, slots],
  );

  useEffect(() => {
    if (!daySelectionTouched) {
      setVisibleDays(defaultVisibleDays);
    }
  }, [daySelectionTouched, defaultVisibleDays]);

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
    setDaySelectionTouched(true);
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
          <span>
            {calendarContext
              ? `AY ${calendarContext.week.academic_year} · Trimester ${calendarContext.week.trimester} · Week ${calendarContext.week.week_number} · ${calendarContext.week.phase_label}${calendarContext.week.holiday_marker}`
              : `Academic week ${weekNumber ?? 1}`}
            {calendarContext?.week.is_provisional ? " · Provisional" : ""}
          </span>
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
            {timeOptions(6, SCHEDULING_DAY_END_HOUR - 1).map((time) => (
              <option key={time} value={time}>
                {formatTime(time, showAmPm)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>End Time</span>
          <select value={displayEndTime} onChange={(event) => updateEndTime(event.target.value)}>
            {timeOptions(7, SCHEDULING_DAY_END_HOUR).map((time) => (
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

      {calendarContext?.lessons_blocked && (
        <div className="calendar-phase-notice" role="status">
          <strong>{calendarContext.week.phase_label}</strong>
          <span>No lessons are scheduled during this academic-calendar week.</span>
        </div>
      )}

      {calendarContext && calendarContext.makeup_required_count > 0 && (
        <div className="calendar-makeup-notice" role="status">
          <strong>
            {calendarContext.makeup_required_count} class{calendarContext.makeup_required_count === 1 ? "" : "es"} need
            make-up sessions
          </strong>
          <span>
            Public holiday: {Array.from(new Set(calendarContext.holidays.map((holiday) => holiday.name))).join(", ")}
          </span>
        </div>
      )}

      <div
        className="calendar-board"
        data-timetable-selection-surface
        role="grid"
        aria-label="Weekly timetable calendar"
        style={{ gridTemplateColumns: `70px repeat(${dayHeadings.length}, minmax(178px, 1fr))` }}
      >
        <div className="calendar-corner">Time</div>
        {dayHeadings.map(({ day, date, holiday }) => (
          <div className={`calendar-day-heading ${holiday ? "public-holiday" : ""}`} key={day}>
            <strong>{day}</strong>
            <span>
              {date.getDate()} {MONTHS[date.getMonth()]}
            </span>
            {holiday && <small title={holiday.name}>{holiday.name}</small>}
          </div>
        ))}

        <div className="calendar-time-rail" style={{ height: calendarHeight }}>
          {slots.map((slot) => (
            <div className="calendar-time-label" key={slot.key} style={{ height: HOUR_HEIGHT }}>
              {formatTime(slot.start_time, showAmPm)}
            </div>
          ))}
          <div
            aria-label={`Timetable ends at ${formatTime(terminalTime, showAmPm)}`}
            className="calendar-time-label calendar-time-label-terminal"
            data-testid="calendar-terminal-time"
          >
            {formatTime(terminalTime, showAmPm)}
          </div>
        </div>

        {dayHeadings.map(({ day, holiday }) => (
          <div
            className={`calendar-day-column ${holiday ? "public-holiday" : ""}`}
            key={day}
            style={{ height: calendarHeight }}
          >
            {slots.map((slot) => {
              const key = `${day}|${slot.start_time}|${slot.end_time}`;
              const slotRows = grouped.get(key) ?? [];
              const selected = key === selectedSlotKey;
              const isConflictCell = conflictSlotKeys.has(key);
              const calendarBlockReason = holiday
                ? `${holiday.name}: classes require make-up`
                : calendarContext?.lessons_blocked
                  ? `${calendarContext.week.phase_label}: lessons are blocked`
                  : null;
              const isBlockedCell = blockedSlotKeys.has(key) || Boolean(calendarBlockReason);
              const isSoftAvailableCell = !isBlockedCell && softAvailableSlotKeys.has(key);
              const isAvailableCell = !isBlockedCell && availableSlotKeys.has(key) && !isSoftAvailableCell;
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
                  } ${isSoftAvailableCell ? "conflict-soft-available" : ""} ${isBlockedCell ? "conflict-blocked" : ""}`}
                  disabled={Boolean(calendarBlockReason) || (!slotRows.length && !onSelectSlot && !isPlacing)}
                  key={key}
                  onClick={() => onSelectSlot?.(key, slotRows)}
                  style={{ height: HOUR_HEIGHT }}
                  title={
                    calendarBlockReason ? calendarBlockReason : isBlockedCell ? "Hard conflict blocked" : undefined
                  }
                  type="button"
                />
              );
            })}

            {events
              .filter((event) => event.day === day)
              .map((event) => {
                const hasConflict = event.slotKeys.some((key) => conflictSlotKeys.has(key));
                const isSelected = event.slotKeys.some((key) => key === selectedSlotKey);
                if (event.kind === "cluster") {
                  const firstKey = event.slotKeys[0] ?? getFirstOverlapKey(event.rows[0], slots);
                  const labCount = event.rows.filter(isLabRequirement).length;
                  const issueToneClass = timetableIssueToneClass(event.rows, issueToneBySessionId);
                  return (
                    <button
                      aria-pressed={isSelected}
                      className={`calendar-event calendar-event-group ${labCount ? "lab-requirement" : ""} ${
                        hasConflict ? "conflict-current" : ""
                      } ${isSelected ? "selected" : ""} ${issueToneClass}`}
                      disabled={!onSelectSlot}
                      key={event.id}
                      onClick={() => {
                        if (isPlacing) {
                          onSelectSlot?.(firstKey, event.rows);
                          return;
                        }
                        onSelectSlot?.(firstKey, event.rows, { focusSlotDetails: true });
                      }}
                      style={event.style}
                      title={event.rows.map((row) => eventTitle(row, showAmPm)).join("\n")}
                      type="button"
                    >
                      <strong>{event.rows.length} sessions</strong>
                      {labCount > 0 && <span className="calendar-event-source">{labCount} lab</span>}
                      <span>
                        {formatTime(minutesToTime(event.start), showAmPm)} -{" "}
                        {formatTime(minutesToTime(event.end), showAmPm)}
                      </span>
                      <small>
                        {event.rows
                          .slice(0, 3)
                          .map((row) => row.module_code ?? row.requirement_id ?? `Session ${row.session_id}`)
                          .join(", ")}
                        {event.rows.length > 3 ? ` +${event.rows.length - 3}` : ""}
                      </small>
                    </button>
                  );
                }

                const firstKey = getFirstOverlapKey(event.row, slots);
                const slotRows = grouped.get(firstKey) ?? [event.row];
                const issueToneClass = timetableIssueToneClass([event.row], issueToneBySessionId);
                return (
                  <button
                    aria-pressed={isSelected}
                    className={`calendar-event ${event.density} ${isLabRequirement(event.row) ? "lab-requirement" : ""} ${
                      hasConflict ? "conflict-current" : ""
                    } ${isSelected ? "selected" : ""} ${issueToneClass}`}
                    disabled={!onSelectSlot}
                    key={event.row.scheduled_session_id}
                    onClick={() => onSelectSlot?.(firstKey, slotRows)}
                    style={event.style}
                    title={eventTitle(event.row, showAmPm)}
                    type="button"
                  >
                    <strong>
                      {event.row.module_code ?? event.row.requirement_id ?? `Session ${event.row.session_id}`}
                    </strong>
                    {isLabRequirement(event.row) && <span className="calendar-event-source">Lab</span>}
                    {showClassTitle && (
                      <span className="calendar-event-class">
                        {[event.row.student_group_code, event.row.class_type].filter(Boolean).join(" - ") || "Class"}
                      </span>
                    )}
                    <span className="calendar-event-time">
                      {formatTime(event.row.start_time, showAmPm)} - {formatTime(event.row.end_time, showAmPm)}
                    </span>
                    <span className="calendar-event-location">
                      {event.row.delivery_mode === "Online" ? "Online" : event.row.room}
                    </span>
                    {showInstructors && (
                      <small className="calendar-event-instructor">
                        {event.row.co_teacher_names || event.row.staff_name || "No instructor"}
                      </small>
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

function timetableIssueToneClass(rows: ScheduledRow[], tones: Map<number, TimetableIssueTone>) {
  const rowTones = rows.map((row) => tones.get(row.session_id));
  if (rowTones.includes("hard")) return "issue-tone-hard";
  if (rowTones.includes("soft")) return "issue-tone-soft";
  return "issue-tone-clean";
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
    const timedRows = dayRows
      .slice()
      .sort((left, right) => timeToMinutes(left.start_time) - timeToMinutes(right.start_time))
      .map((row) => ({
        row,
        start: Math.max(timeToMinutes(row.start_time), rangeStart),
        end: Math.min(timeToMinutes(row.end_time), rangeEnd),
      }));

    const clusters: { end: number; items: typeof timedRows }[] = [];
    timedRows.forEach((item) => {
      const activeCluster = clusters[clusters.length - 1];
      if (activeCluster && item.start < activeCluster.end) {
        activeCluster.items.push(item);
        activeCluster.end = Math.max(activeCluster.end, item.end);
        return;
      }
      clusters.push({ end: item.end, items: [item] });
    });

    return clusters.flatMap((cluster): CalendarLayoutItem[] => {
      const lanes: number[] = [];
      const assigned = cluster.items.map((item) => {
        const lane = lanes.findIndex((laneEnd) => laneEnd <= item.start);
        const nextLane = lane >= 0 ? lane : lanes.length;
        lanes[nextLane] = item.end;
        return { ...item, lane: nextLane };
      });
      const laneCount = Math.max(1, lanes.length);
      const clusterRows = cluster.items.map((item) => item.row);
      const isCrowdedSlot = maxRowsInPlannerSlot(clusterRows, slots) > MAX_DETAILED_EVENTS_PER_SLOT;

      if (laneCount > MAX_DETAILED_LANES || isCrowdedSlot) {
        const start = Math.min(...cluster.items.map((item) => item.start));
        const end = Math.max(...cluster.items.map((item) => item.end));
        const slotKeys = uniqueSlotKeys(clusterRows, slots);
        return [
          {
            kind: "cluster",
            day: clusterRows[0].day,
            id: `cluster-${clusterRows[0].day}-${start}-${end}-${clusterRows.map((row) => row.session_id).join("-")}`,
            rows: clusterRows,
            start,
            end,
            slotKeys,
            style: {
              height: Math.max(42, ((end - start) / 60) * HOUR_HEIGHT - 6),
              left: 5,
              top: ((start - rangeStart) / 60) * HOUR_HEIGHT + 3,
              width: "calc(100% - 10px)",
            },
          },
        ];
      }

      return assigned.map(({ row, start, end, lane }) => {
        const width = 100 / laneCount;
        const left = width * lane;
        const durationMinutes = end - start;
        const slotKeys = slots
          .filter((slot) => intervalsOverlap(row.start_time, row.end_time, slot.start_time, slot.end_time))
          .map((slot) => `${row.day}|${slot.start_time}|${slot.end_time}`);
        return {
          kind: "event",
          day: row.day,
          row,
          slotKeys,
          density: eventDensity(durationMinutes, laneCount),
          style: {
            height: Math.max(36, ((end - start) / 60) * HOUR_HEIGHT - 6),
            left: `calc(${left}% + 4px)`,
            top: ((start - rangeStart) / 60) * HOUR_HEIGHT + 3,
            width: `calc(${width}% - 8px)`,
          } satisfies CSSProperties,
        };
      });
    });
  });
}

function maxRowsInPlannerSlot(rows: ScheduledRow[], slots: PlannerSlot[]) {
  return slots.reduce((largest, slot) => {
    const count = rows.filter((row) =>
      intervalsOverlap(row.start_time, row.end_time, slot.start_time, slot.end_time),
    ).length;
    return Math.max(largest, count);
  }, 0);
}

function eventDensity(durationMinutes: number, laneCount: number): CalendarEventDensity {
  if (laneCount >= 3 || durationMinutes <= 45) {
    return "compact";
  }
  if (durationMinutes <= 60) {
    return "short";
  }
  return "normal";
}

function uniqueSlotKeys(rows: ScheduledRow[], slots: PlannerSlot[]) {
  return Array.from(
    new Set(
      rows.flatMap((row) =>
        slots
          .filter((slot) => intervalsOverlap(row.start_time, row.end_time, slot.start_time, slot.end_time))
          .map((slot) => `${row.day}|${slot.start_time}|${slot.end_time}`),
      ),
    ),
  );
}

function eventTitle(row: ScheduledRow, showAmPm: boolean) {
  const label = row.module_code ?? row.requirement_id ?? `Session ${row.session_id}`;
  const source = isLabRequirement(row) ? " | Lab requirement" : "";
  const group = row.student_group_code ? ` | ${row.student_group_code}` : "";
  const room = row.delivery_mode === "Online" ? "Online" : row.room;
  return `${label}${source}${group} | ${formatTime(row.start_time, showAmPm)} - ${formatTime(row.end_time, showAmPm)} | ${room}`;
}

function isLabRequirement(row: ScheduledRow) {
  return row.is_lab_requirement === true || (row.requirement_id ?? "").startsWith("LAB-");
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
