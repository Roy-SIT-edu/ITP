import type { ScheduledRow } from "../../types";
import { days, type MoveDraft, type PlannerSlot } from "./types";
import { heatClass, intervalsOverlap } from "./timetableUtils";

type Props = {
  slots: PlannerSlot[];
  grouped: Map<string, ScheduledRow[]>;
  selectedSlotKey?: string | null;
  isPlacing?: boolean;
  selectedSessionDraft?: MoveDraft;
  onSelectSlot?: (key: string, rows: ScheduledRow[]) => void;
};

export default function TimetablePlanner({
  slots,
  grouped,
  selectedSlotKey,
  isPlacing,
  selectedSessionDraft,
  onSelectSlot,
}: Props) {
  return (
    <div className="planner-shell">
      <div className="planner-grid" role="grid" aria-label="Timetable planner summary">
        <div className="planner-corner">Time</div>
        {days.map((day) => (
          <div className="planner-day-heading" key={day}>
            {day}
          </div>
        ))}
        {slots.map((slot) => (
          <div className="planner-row" key={slot.key}>
            <div className="planner-time">{slot.label}</div>
            {days.map((day) => {
              const key = `${day}|${slot.start_time}|${slot.end_time}`;
              const slotRows = grouped.get(key) ?? [];
              const selected = key === selectedSlotKey;
              const count = slotRows.length;
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
                  className={`planner-cell ${count ? heatClass(count) : "empty"} ${selected ? "selected" : ""} ${
                    isPlacing ? "placing-mode" : ""
<<<<<<< Updated upstream
                  } ${draftSelected ? "highlight-draft" : ""}`}
                  disabled={!count && !onSelectSlot && !isPlacing}
=======
                  } ${draftSelected ? "highlight-draft" : ""} ${isConflictCell ? "conflict-current" : ""} ${
                    isAvailableCell ? "conflict-available" : ""
                  } ${isSoftAvailableCell ? "conflict-soft-available" : ""} ${isBlockedCell ? "conflict-blocked" : ""}`}
                  disabled={(isPlacing && isBlockedCell) || (!slotRows.length && !onSelectSlot && !isPlacing)}
>>>>>>> Stashed changes
                  key={key}
                  onClick={() => onSelectSlot?.(key, slotRows)}
                  type="button"
                >
                  <span className="planner-cell-count">{count}</span>
                  <span className="planner-cell-label">{count === 1 ? "session" : "sessions"}</span>
                  {slotRows.slice(0, 2).map((row) => (
                    <small key={row.session_id}>{row.module_code ?? row.requirement_id}</small>
                  ))}
                  {count > 2 && <em>+{count - 2} more</em>}
                </button>
              );
            })}
<<<<<<< Updated upstream
=======

            {events
              .filter((event) => event.day === day)
              .map((event) => {
                const hasConflict = event.slotKeys.some((key) => conflictSlotKeys.has(key));
                const isSelected = event.slotKeys.some((key) => key === selectedSlotKey);
                if (event.kind === "cluster") {
                  const firstKey = event.slotKeys[0] ?? getFirstOverlapKey(event.rows[0], slots);
                  const labCount = event.rows.filter(isLabRequirement).length;
                  return (
                    <button
                      aria-pressed={isSelected}
                      className={`calendar-event calendar-event-group ${labCount ? "lab-requirement" : ""} ${
                        hasConflict ? "conflict-current" : ""
                      } ${isSelected ? "selected" : ""}`}
                      data-timetable-selection-surface
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
                return (
                  <button
                    aria-pressed={isSelected}
                    className={`calendar-event ${event.density} ${isLabRequirement(event.row) ? "lab-requirement" : ""} ${
                      hasConflict ? "conflict-current" : ""
                    } ${isSelected ? "selected" : ""}`}
                    data-timetable-selection-surface
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
>>>>>>> Stashed changes
          </div>
        ))}
      </div>
      <div className="planner-legend">
        <div className="legend-group">
          <span className="legend-title">Density:</span>
          <span>
            <i className="load-0" />0
          </span>
          <span>
            <i className="load-1" />1
          </span>
          <span>
            <i className="load-2" />2
          </span>
          <span>
            <i className="load-4" />
            3-4
          </span>
          <span>
            <i className="load-5" />
            5+
          </span>
        </div>
        {isPlacing && (
          <div className="legend-group">
            <span className="legend-title">Placement:</span>
            <span>
              <i className="legend-draft" />
              Draft Move
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
<<<<<<< Updated upstream
=======

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
>>>>>>> Stashed changes
