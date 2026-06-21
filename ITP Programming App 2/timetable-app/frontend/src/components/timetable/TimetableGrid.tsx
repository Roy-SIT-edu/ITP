import { useEffect, useMemo, useState } from "react";
import type { Room, ScheduledRow, TimeSlot } from "../../types";
import MoveControls from "./MoveControls";
import TimetablePlanner from "./TimetablePlanner";
import type { MoveDraft } from "./types";
import { buildPlannerSlots, duration, getFirstOverlapKey, groupRowsBySlot } from "./timetableUtils";

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
  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(
    rows[0] ? getFirstOverlapKey(rows[0], slots) : null,
  );
  const [isPlacing, setIsPlacing] = useState(false);
  const selectedRow = useMemo(
    () => rows.find((row) => row.session_id === selectedSessionId) ?? rows[0] ?? null,
    [rows, selectedSessionId],
  );
  const selectedSlotRows = useMemo(() => grouped.get(selectedSlotKey ?? "") ?? [], [grouped, selectedSlotKey]);

  useEffect(() => {
    if (rows.length === 0) {
      setSelectedSessionId(null);
      setSelectedSlotKey(null);
      return;
    }
    if (!rows.some((row) => row.session_id === selectedSessionId)) {
      setSelectedSessionId(rows[0].session_id);
    }
    if (!selectedSlotKey || !grouped.has(selectedSlotKey)) {
      setSelectedSlotKey(getFirstOverlapKey(rows[0], slots));
    }
  }, [grouped, rows, selectedSessionId, selectedSlotKey, slots]);

  if (editable) {
    return (
      <div className="review-timetable-workspace">
        <div className="timetable-board-panel">
          <TimetablePlanner
            slots={slots}
            grouped={grouped}
            selectedSlotKey={selectedSlotKey}
            isPlacing={isPlacing}
            selectedSessionDraft={
              selectedSessionId && moveDrafts[selectedSessionId] ? moveDrafts[selectedSessionId] : undefined
            }
            onSelectSlot={(key, slotRows) => {
              if (isPlacing && selectedRow) {
                const [day, startTime, endTime] = key.split("|");
                const draft = moveDrafts[selectedRow.session_id] ?? {
                  day: selectedRow.day,
                  start_time: selectedRow.start_time,
                  end_time: selectedRow.end_time,
                  room_code: selectedRow.room,
                };
                const rowDuration = duration(selectedRow);
                const matchingSlot = timeSlots.find(
                  (slot) => slot.day === day && slot.start_time === startTime && slot.duration_minutes === rowDuration,
                );
                onChangeMove?.(selectedRow.session_id, {
                  ...draft,
                  day,
                  start_time: startTime,
                  end_time: matchingSlot ? matchingSlot.end_time : endTime,
                });
                setIsPlacing(false);
                setSelectedSlotKey(key);
                return;
              }
              if (slotRows.length > 0) {
                setSelectedSlotKey(key);
                setSelectedSessionId(slotRows[0].session_id);
              }
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
          isPlacing={isPlacing}
          setIsPlacing={setIsPlacing}
        />
      </div>
    );
  }

  return (
    <>
      <TimetablePlanner slots={slots} grouped={grouped} />

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
                <td>{row.co_teacher_names || row.staff_name}</td>
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
                <span>
                  {row.programme ?? "No programme"} | {row.class_type ?? "Class"} |{" "}
                  {row.student_group_code ?? "No group"}
                </span>
                <small>
                  {row.room} | {row.co_teacher_names || row.staff_name || "No staff"}
                </small>
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
  isPlacing,
  setIsPlacing,
}: {
  row: ScheduledRow | null;
  rooms: Room[];
  timeSlots: TimeSlot[];
  moveDrafts: Record<number, MoveDraft>;
  savingMove: number | null;
  onChangeMove?: (sessionId: number, value: MoveDraft) => void;
  onSaveMove?: (row: ScheduledRow) => void;
  isPlacing: boolean;
  setIsPlacing: (value: boolean) => void;
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
            {row.co_teacher_names || row.staff_name || "No staff"} | {row.delivery_mode ?? "Mode not set"} |{" "}
            {row.week_pattern ?? "Weeks not set"}
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
          isPlacing={isPlacing}
          setIsPlacing={setIsPlacing}
        />
      </div>
    </section>
  );
}
