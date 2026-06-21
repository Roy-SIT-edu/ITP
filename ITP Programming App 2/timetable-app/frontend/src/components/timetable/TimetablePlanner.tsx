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
                  } ${draftSelected ? "highlight-draft" : ""}`}
                  disabled={!count && !onSelectSlot && !isPlacing}
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
