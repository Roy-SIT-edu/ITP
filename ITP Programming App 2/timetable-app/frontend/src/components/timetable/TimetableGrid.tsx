<<<<<<< Updated upstream
import { useEffect, useMemo, useState } from "react";
import type { Room, ScheduledRow, TimeSlot } from "../../types";
import MoveControls from "./MoveControls";
import TimetablePlanner from "./TimetablePlanner";
import type { MoveDraft } from "./types";
import { buildPlannerSlots, duration, getFirstOverlapKey, groupRowsBySlot } from "./timetableUtils";
=======
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Room, ScheduledRow, TimeSlot, SessionRow } from "../../types";
import MoveControls from "./MoveControls";
import TimetablePlanner from "./TimetablePlanner";
import { days, type MoveDraft } from "./types";
import { buildPlannerSlots, duration, groupRowsBySlot, timeToMinutes } from "./timetableUtils";
import { getSession, updateSession, recheckSchedule } from "../../api/client";
>>>>>>> Stashed changes

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
<<<<<<< Updated upstream
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
=======
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [baseWeekStart] = useState(() => startOfWeek(new Date()));
  const [displayStartTime, setDisplayStartTime] = useState("08:00");
  const [displayEndTime, setDisplayEndTime] = useState("22:00");
  const baseWeekRows = allRows ?? rows;
  const baseWeekNumber = useMemo(() => firstScheduledWeek(baseWeekRows), [baseWeekRows]);
  const selectedWeekNumber = useMemo(
    () => Math.max(1, baseWeekNumber + Math.round((weekStart.getTime() - baseWeekStart.getTime()) / WEEK_MS)),
    [baseWeekNumber, baseWeekStart, weekStart],
  );
  const visibleRows = useMemo(
    () => rows.filter((row) => rowOccursInWeek(row, selectedWeekNumber)),
    [rows, selectedWeekNumber],
  );
  const slots = useMemo(
    () => buildPlannerSlots(visibleRows, timeSlots, displayStartTime, displayEndTime),
    [displayEndTime, displayStartTime, timeSlots, visibleRows],
  );
  const grouped = useMemo(() => groupRowsBySlot(visibleRows, slots), [visibleRows, slots]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(null);
  const [selectedRowsOverride, setSelectedRowsOverride] = useState<ScheduledRow[] | null>(null);
  const [slotDetailsAttention, setSlotDetailsAttention] = useState(0);
  const [isPlacing, setIsPlacing] = useState(false);
  const selectedRow = useMemo(
    () =>
      selectedSessionId === null ? null : (visibleRows.find((row) => row.session_id === selectedSessionId) ?? null),
    [visibleRows, selectedSessionId],
>>>>>>> Stashed changes
  );
  const selectedSlotRows = useMemo(() => grouped.get(selectedSlotKey ?? "") ?? [], [grouped, selectedSlotKey]);

  const clearSelection = useCallback(() => {
    setSelectedSessionId(null);
    setSelectedSlotKey(null);
    setSelectedRowsOverride(null);
    setIsPlacing(false);
    onSelectSession?.(null);
  }, [onSelectSession]);

  useEffect(() => {
<<<<<<< Updated upstream
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
=======
    if (selectedSessionId !== null && !visibleRows.some((row) => row.session_id === selectedSessionId)) {
      clearSelection();
      return;
    }
    if (selectedSlotKey && !grouped.has(selectedSlotKey)) {
      setSelectedSlotKey(null);
      setSelectedRowsOverride(null);
    }
  }, [clearSelection, grouped, visibleRows, selectedSessionId, selectedSlotKey]);

  useEffect(() => {
    if (selectedSessionId === null || isPlacing) return;

    const clearOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest("[data-timetable-selection-surface]")) return;
      clearSelection();
    };

    document.addEventListener("pointerdown", clearOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", clearOnOutsidePointer, true);
  }, [clearSelection, isPlacing, selectedSessionId]);

  useEffect(() => {
    if (
      selectedRowsOverride &&
      selectedRowsOverride.some((row) => !visibleRows.some((visibleRow) => visibleRow.session_id === row.session_id))
    ) {
      setSelectedRowsOverride(null);
    }
  }, [selectedRowsOverride, visibleRows]);
>>>>>>> Stashed changes

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
<<<<<<< Updated upstream
    <section className="slot-detail-panel">
=======
    <section
      className={`slot-detail-panel ${isHighlighted ? "attention" : ""}`}
      data-timetable-selection-surface
      ref={panelRef}
    >
>>>>>>> Stashed changes
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
      <section className="schedule-edit-panel selected-session-panel" data-timetable-selection-surface>
        <div className="empty-state">Select a session from the timetable to view or edit it.</div>
      </section>
    );
  }

  return (
    <section className="schedule-edit-panel selected-session-panel" data-timetable-selection-surface>
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
<<<<<<< Updated upstream
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
=======

        {scheduleRunId && sessionData && (
          <div className="move-controls">
            <div className="move-controls-header">
              <div>
                <strong>Edit Session</strong>
                <span>Requirements and placement</span>
              </div>
              <div className="selected-session-editor-actions">
                <button
                  className={`button slim ${isPlacing ? "primary" : "secondary"}`}
                  onClick={() => {
                    onSelectSession?.(row.session_id);
                    setIsPlacing(!isPlacing);
                  }}
                  type="button"
                >
                  {isPlacing ? "Cancel Selection" : "Pick Time"}
                </button>
                <button className="button primary slim" disabled={isSaving} onClick={handleSaveAll}>
                  {isSaving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>

            {errorDetails && <div className="notice bad selected-session-error">{errorDetails}</div>}

            <div className="selected-session-editor-grid">
              <label className="move-field selected-session-field-wide">
                <span>Staff</span>
                <select
                  value={sessionData.staff_id ?? ""}
                  onChange={(e) => {
                    setSessionData({ ...sessionData, staff_id: e.target.value || null });
                    setIsSessionDirty(true);
                  }}
                >
                  <option value="">-- No Staff --</option>
                  {staffOptions?.map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.name} ({staff.id})
                    </option>
                  ))}
                </select>
              </label>

              <label className="move-field">
                <span>Type</span>
                <select value={sessionData.is_lab_requirement ? "Fixed" : "Flexible"} disabled>
                  <option value="Flexible">Flexible</option>
                  <option value="Fixed">Fixed lab</option>
                </select>
              </label>

              <label className="move-field">
                <span>Mode</span>
                <select
                  value={sessionData.delivery_mode ?? ""}
                  onChange={(e) => {
                    setSessionData({ ...sessionData, delivery_mode: e.target.value });
                    setIsSessionDirty(true);
                  }}
                >
                  <option value="">-- Select --</option>
                  <option value="F2F">F2F</option>
                  <option value="Online">Online</option>
                  <option value="Blended">Blended</option>
                </select>
              </label>

              <label className="move-field">
                <span>Venue</span>
                <select
                  value={sessionData.venue_type_required ?? ""}
                  onChange={(e) => {
                    setSessionData({ ...sessionData, venue_type_required: e.target.value });
                    setIsSessionDirty(true);
                  }}
                >
                  <option value="">-- Any --</option>
                  <option value="Classroom">Classroom</option>
                  <option value="Lecture Theatre">Lecture Theatre</option>
                  <option value="Computer Lab">Computer Lab</option>
                  <option value="Science Lab">Science Lab</option>
                </select>
              </label>
              <label className="move-field">
                <span>Day</span>
                <select value={draft.day} onChange={(e) => updateMove({ day: e.target.value })}>
                  {days.map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>

              <label className="move-field">
                <span>Time</span>
                <select value={draft.start_time} onChange={(e) => updateMove({ start_time: e.target.value })}>
                  {matchingSlots.map((slot) => (
                    <option key={`${slot.day}-${slot.start_time}-${slot.end_time}`} value={slot.start_time}>
                      {slot.start_time}-{slot.end_time}
                    </option>
                  ))}
                </select>
              </label>

              <label className="move-field">
                <span>Room</span>
                <input
                  list={`room-options-${row.session_id}`}
                  value={draft.room_code}
                  onChange={(e) => updateMove({ room_code: e.target.value })}
                  placeholder="Select a room"
                />
              </label>
            </div>

            <datalist id={`room-options-${row.session_id}`}>
              {rooms.map((room) => (
                <option key={room.id} value={room.room_code}>
                  {room.room_code}
                </option>
              ))}
            </datalist>
          </div>
        )}
>>>>>>> Stashed changes
      </div>
    </section>
  );
}
