/*
 * Timetable grid for reviewing and manually adjusting generated scheduled sessions.
 */

import { useEffect, useMemo, useState } from "react";
import type { Room, ScheduledRow, TimeSlot } from "../types";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

type MoveDraft = {
  day: string;
  start_time: string;
  end_time: string;
  room_code: string;
};

type Props = {
  rows: ScheduledRow[];
  editable?: boolean;
  rooms?: Room[];
  timeSlots?: TimeSlot[];
  moveDrafts?: Record<number, MoveDraft>;
  savingMove?: number | null;
  onChangeMove?: (sessionId: number, value: MoveDraft) => void;
  onSaveMove?: (row: ScheduledRow) => void;
};

export default function TimetableGrid({
  rows,
  editable = false,
  rooms = [],
  timeSlots = [],
  moveDrafts = {},
  savingMove = null,
  onChangeMove,
  onSaveMove,
}: Props) {
  const slots = useMemo(() => buildPlannerSlots(rows, timeSlots), [rows, timeSlots]);
  const grouped = useMemo(() => groupRowsBySlot(rows, slots), [rows, slots]);

  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(rows[0]?.session_id ?? null);
  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(rows[0] ? getFirstOverlapKey(rows[0], slots) : null);
  
  const selectedRow = useMemo(
    () => rows.find((row) => row.session_id === selectedSessionId) ?? rows[0] ?? null,
    [rows, selectedSessionId],
  );
  const selectedSlotRows = useMemo(
    () => grouped.get(selectedSlotKey ?? "") ?? [],
    [grouped, selectedSlotKey],
  );

  useEffect(() => {
    if (rows.length === 0) {
      setSelectedSessionId(null);
      setSelectedSlotKey(null);
      return;
    }
    if (!rows.some((row) => row.session_id === selectedSessionId)) {
      setSelectedSessionId(rows[0].session_id);
    }
    const currentOverlaps = rows.some((row) => getFirstOverlapKey(row, slots) === selectedSlotKey);
    if (!selectedSlotKey || !currentOverlaps) {
      setSelectedSlotKey(getFirstOverlapKey(rows[0], slots));
    }
  }, [rows, selectedSessionId, selectedSlotKey, slots]);

  if (editable) {
    return (
      <div className="review-timetable-workspace">
        <div className="timetable-board-panel">
          <TimetablePlanner
            rows={rows}
            slots={slots}
            grouped={grouped}
            selectedSlotKey={selectedSlotKey}
            onSelectSlot={(key, slotRows) => {
              setSelectedSlotKey(key);
              setSelectedSessionId(slotRows[0]?.session_id ?? null);
            }}
          />
        </div>
        <SlotSessionList
          rows={selectedSlotRows}
          selectedSessionId={selectedRow?.session_id ?? null}
          onSelect={setSelectedSessionId}
        />
        <SelectedSessionEditor
          row={selectedRow}
          rooms={rooms}
          timeSlots={timeSlots}
          moveDrafts={moveDrafts}
          savingMove={savingMove}
          onChangeMove={onChangeMove}
          onSaveMove={onSaveMove}
        />
      </div>
    );
  }

  return (
    <>
      <TimetablePlanner rows={rows} slots={slots} grouped={grouped} />

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Programme</th>
              <th>Module</th>
              <th>Type</th>
              <th>Group</th>
              <th>Staff</th>
              <th>Room</th>
              <th>Day</th>
              <th>Start</th>
              <th>End</th>
              <th>Weeks</th>
              <th>Mode</th>
              {editable && <th>Edit Slot</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.requirement_id}-${row.day}-${row.start_time}-${row.room}`}>
                <td>{row.programme}</td>
                <td>{row.module_code}</td>
                <td>{row.class_type}</td>
                <td>{row.student_group_code}</td>
                <td>{row.staff_name}</td>
                <td>{row.room}</td>
                <td>{row.day}</td>
                <td>{row.start_time}</td>
                <td>{row.end_time}</td>
                <td>{row.week_pattern}</td>
                <td>{row.delivery_mode}</td>
                {editable && (
                  <td>
                    <MoveControls
                      row={row}
                      rooms={rooms}
                      timeSlots={timeSlots}
                      value={moveDrafts[row.session_id]}
                      saving={savingMove === row.session_id}
                      onChange={(value) => onChangeMove?.(row.session_id, value)}
                      onSave={() => onSaveMove?.(row)}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TimetablePlanner({
  rows,
  slots,
  grouped,
  selectedSlotKey,
  onSelectSlot,
}: {
  rows: ScheduledRow[];
  slots: { key: string; start_time: string; end_time: string; label: string }[];
  grouped: Map<string, ScheduledRow[]>;
  selectedSlotKey?: string | null;
  onSelectSlot?: (key: string, rows: ScheduledRow[]) => void;
}) {
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
              return (
                <button
                  className={`planner-cell ${count ? heatClass(count) : "empty"} ${selected ? "selected" : ""}`}
                  disabled={!count && !onSelectSlot}
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
        <span><i className="load-0" />0</span>
        <span><i className="load-1" />1</span>
        <span><i className="load-2" />2</span>
        <span><i className="load-4" />3-4</span>
        <span><i className="load-5" />5+</span>
      </div>
    </div>
  );
}

function SlotSessionList({
  rows,
  selectedSessionId,
  onSelect,
}: {
  rows: ScheduledRow[];
  selectedSessionId: number | null;
  onSelect: (sessionId: number) => void;
}) {
  const label = rows[0] ? `${rows[0].day}, ${rows[0].start_time}-${rows[0].end_time}` : "No slot selected";

  return (
    <section className="slot-detail-panel">
      <div className="schedule-edit-heading">
        <div>
          <strong>Slot Details</strong>
          <span>{label}</span>
        </div>
        <small>{rows.length} sessions</small>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">Select a busy time cell to inspect its sessions.</div>
      ) : (
        <div className="slot-session-list">
          {rows
            .slice()
            .sort((left, right) => (left.module_code ?? "").localeCompare(right.module_code ?? ""))
            .map((row) => (
              <button
                className={`slot-session-card ${selectedSessionId === row.session_id ? "selected" : ""}`}
                key={row.session_id}
                onClick={() => onSelect(row.session_id)}
                type="button"
              >
                <strong>{row.module_code ?? row.requirement_id}</strong>
                <span>{row.programme ?? "No programme"} | {row.class_type ?? "Class"} | {row.student_group_code ?? "No group"}</span>
                <small>{row.room} | {row.staff_name ?? "No staff"}</small>
              </button>
            ))}
        </div>
      )}
    </section>
  );
}

function SelectedSessionEditor({
  row,
  rooms,
  timeSlots,
  moveDrafts,
  savingMove,
  onChangeMove,
  onSaveMove,
}: {
  row: ScheduledRow | null;
  rooms: Room[];
  timeSlots: TimeSlot[];
  moveDrafts: Record<number, MoveDraft>;
  savingMove: number | null;
  onChangeMove?: (sessionId: number, value: MoveDraft) => void;
  onSaveMove?: (row: ScheduledRow) => void;
}) {
  if (!row) {
    return (
      <section className="schedule-edit-panel selected-session-panel">
        <div className="empty-state">No sessions match the current filters.</div>
      </section>
    );
  }

  return (
    <section className="schedule-edit-panel selected-session-panel">
      <div className="schedule-edit-heading">
        <div>
          <strong>Selected Session</strong>
          <span>Click a timetable card to inspect or move that session.</span>
        </div>
        <small>{row.requirement_id}</small>
      </div>
      <div className="selected-session-body">
        <div className="selected-session-main">
          <strong>{row.module_code ?? row.requirement_id}</strong>
          <span>
            {row.programme ?? "No programme"} | {row.class_type ?? "Class"} | {row.student_group_code ?? "No group"}
          </span>
          <small>
            {row.staff_name ?? "No staff"} | {row.delivery_mode ?? "Mode not set"} | {row.week_pattern ?? "Weeks not set"}
          </small>
        </div>
        <div className="selected-session-facts">
          <span>
            <strong>Current slot</strong>
            {row.day}, {row.start_time}-{row.end_time}
          </span>
          <span>
            <strong>Room</strong>
            {row.room}
          </span>
          <span>
            <strong>Session ID</strong>
            {row.session_id}
          </span>
        </div>
        <MoveControls
          row={row}
          rooms={rooms}
          timeSlots={timeSlots}
          value={moveDrafts[row.session_id]}
          saving={savingMove === row.session_id}
          onChange={(value) => onChangeMove?.(row.session_id, value)}
          onSave={() => onSaveMove?.(row)}
        />
      </div>
    </section>
  );
}

function MoveControls({
  row,
  rooms,
  timeSlots,
  value,
  saving,
  onChange,
  onSave,
}: {
  row: ScheduledRow;
  rooms: Room[];
  timeSlots: TimeSlot[];
  value?: MoveDraft;
  saving: boolean;
  onChange: (value: MoveDraft) => void;
  onSave: () => void;
}) {
  const draft = value ?? { day: row.day, start_time: row.start_time, end_time: row.end_time, room_code: row.room };
  const rowDuration = duration(row);
  const matchingSlots = timeSlots.filter((slot) => slot.day === draft.day && slot.duration_minutes === rowDuration);
  const uniqueMatchingSlots = uniqueSlotsByTime(matchingSlots);

  const update = (patch: Partial<typeof draft>) => {
    const next = { ...draft, ...patch };
    const slot = timeSlots.find(
      (item) => item.day === next.day && item.start_time === next.start_time && item.duration_minutes === rowDuration,
    );
    if (slot) {
      next.end_time = slot.end_time;
    }
    onChange(next);
  };

  return (
    <div className="move-controls">
      <select value={draft.day} onChange={(event) => update({ day: event.target.value })}>
        {days.map((day) => (
          <option key={day} value={day}>
            {day}
          </option>
        ))}
      </select>
      <select value={draft.start_time} onChange={(event) => update({ start_time: event.target.value })}>
        {uniqueMatchingSlots.map((slot) => (
          <option key={`${slot.day}-${slot.start_time}-${slot.end_time}`} value={slot.start_time}>
            {slot.start_time}-{slot.end_time}
          </option>
        ))}
      </select>
      <input
        list={`room-options-${row.session_id}`}
        value={draft.room_code}
        onChange={(event) => update({ room_code: event.target.value })}
        placeholder="Search room"
      />
      <datalist id={`room-options-${row.session_id}`}>
        {rooms.map((room) => (
          <option key={room.id} value={room.room_code}>
            {room.room_code}
          </option>
        ))}
      </datalist>
      <button className="button secondary slim" disabled={saving} type="button" onClick={onSave}>
        {saving ? "Saving" : "Move"}
      </button>
    </div>
  );
}

function duration(row: ScheduledRow) {
  const [startHour, startMinute] = row.start_time.split(":").map(Number);
  const [endHour, endMinute] = row.end_time.split(":").map(Number);
  return endHour * 60 + endMinute - (startHour * 60 + startMinute);
}

function uniqueSlotsByTime(timeSlots: TimeSlot[]) {
  const seen = new Set<string>();
  return timeSlots.filter((slot) => {
    const key = `${slot.start_time}-${slot.end_time}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function timeToMinutes(timeStr: string) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + (m || 0);
}

function intervalsOverlap(startA: string, endA: string, startB: string, endB: string) {
  return timeToMinutes(startA) < timeToMinutes(endB) && timeToMinutes(startB) < timeToMinutes(endA);
}

export function getFirstOverlapKey(row: ScheduledRow, plannerSlots: {start_time: string, end_time: string}[]) {
  for (const slot of plannerSlots) {
    if (intervalsOverlap(row.start_time, row.end_time, slot.start_time, slot.end_time)) {
      return `${row.day}|${slot.start_time}|${slot.end_time}`;
    }
  }
  return null;
}

export function buildPlannerSlots(rows: ScheduledRow[], timeSlots: TimeSlot[]) {
  let minHour = 9;
  let maxHour = 17;

  const allTimes = [
    ...timeSlots.flatMap((s) => [s.start_time, s.end_time]),
    ...rows.flatMap((r) => [r.start_time, r.end_time]),
  ];

  allTimes.forEach((time) => {
    if (!time) return;
    const hour = parseInt(time.split(":")[0], 10);
    if (!isNaN(hour)) {
      if (hour < minHour) minHour = hour;
      const minutes = parseInt(time.split(":")[1], 10);
      const effectiveHour = minutes > 0 ? hour + 1 : hour;
      if (effectiveHour > maxHour) maxHour = effectiveHour;
    }
  });

  const slots = [];
  for (let h = minHour; h < maxHour; h++) {
    const start = `${h.toString().padStart(2, "0")}:00`;
    const end = `${(h + 1).toString().padStart(2, "0")}:00`;
    slots.push({
      key: `${start}|${end}`,
      start_time: start,
      end_time: end,
      label: `${start}-${end}`,
    });
  }
  return slots;
}

export function groupRowsBySlot(rows: ScheduledRow[], plannerSlots: {start_time: string, end_time: string}[]) {
  const map = new Map<string, ScheduledRow[]>();
  rows.forEach((row) => {
    plannerSlots.forEach((slot) => {
      if (intervalsOverlap(row.start_time, row.end_time, slot.start_time, slot.end_time)) {
        const key = `${row.day}|${slot.start_time}|${slot.end_time}`;
        map.set(key, [...(map.get(key) ?? []), row]);
      }
    });
  });
  return map;
}

function heatClass(value: number) {
  if (value === 0) return "load-0";
  if (value === 1) return "load-1";
  if (value === 2) return "load-2";
  if (value <= 4) return "load-4";
  return "load-5";
}
