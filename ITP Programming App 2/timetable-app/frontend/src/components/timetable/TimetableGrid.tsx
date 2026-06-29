import { useEffect, useMemo, useState } from "react";
import type { Room, ScheduledRow, TimeSlot, SessionRow } from "../../types";
import MoveControls from "./MoveControls";
import TimetablePlanner from "./TimetablePlanner";
import { days, type MoveDraft } from "./types";
import { buildPlannerSlots, duration, getFirstOverlapKey, groupRowsBySlot } from "./timetableUtils";
import { getSession, updateSession, recheckSchedule } from "../../api/client";

type Props = {
  rows: ScheduledRow[];
  allRows?: ScheduledRow[];
  editable?: boolean;
  rooms?: Room[];
  timeSlots?: TimeSlot[];
  moveDrafts?: Record<number, MoveDraft>;
  savingMove?: number | null;
  onChangeMove?: (sessionId: number, value: MoveDraft) => void;
  onSaveMove?: (row: ScheduledRow) => void;
  conflictSlotKeys?: Set<string>;
  availableSlotKeys?: Set<string>;
  onClickAvailableSlot?: (day: string, startTime: string, endTime: string) => void;
  scheduleRunId?: number;
  onRefresh?: () => void;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export default function TimetableGrid({
  rows,
  allRows,
  editable = false,
  rooms = [],
  timeSlots = [],
  moveDrafts = {},
  savingMove = null,
  onChangeMove,
  onSaveMove,
  conflictSlotKeys = new Set(),
  availableSlotKeys = new Set(),
  onClickAvailableSlot,
  scheduleRunId,
  onRefresh,
}: Props) {
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
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(visibleRows[0]?.session_id ?? null);
  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(
    visibleRows[0] ? getFirstOverlapKey(visibleRows[0], slots) : null,
  );
  const [isPlacing, setIsPlacing] = useState(false);
  const selectedRow = useMemo(
    () => visibleRows.find((row) => row.session_id === selectedSessionId) ?? visibleRows[0] ?? null,
    [visibleRows, selectedSessionId],
  );
  const selectedSlotRows = useMemo(() => grouped.get(selectedSlotKey ?? "") ?? [], [grouped, selectedSlotKey]);

  const staffOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.staff_id) {
        map.set(r.staff_id, r.staff_name || r.staff_id);
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => ({ id, name }));
  }, [rows]);

  useEffect(() => {
    if (visibleRows.length === 0) {
      setSelectedSessionId(null);
      setSelectedSlotKey(null);
      return;
    }
    if (!visibleRows.some((row) => row.session_id === selectedSessionId)) {
      setSelectedSessionId(visibleRows[0].session_id);
    }
    if (!selectedSlotKey || !grouped.has(selectedSlotKey)) {
      setSelectedSlotKey(getFirstOverlapKey(visibleRows[0], slots));
    }
  }, [grouped, visibleRows, selectedSessionId, selectedSlotKey, slots]);

  if (editable) {
    return (
      <div className="review-timetable-workspace">
        <div className="timetable-board-panel">
          <TimetablePlanner
            rows={visibleRows}
            slots={slots}
            grouped={grouped}
            weekStart={weekStart}
            weekNumber={selectedWeekNumber}
            displayStartTime={displayStartTime}
            displayEndTime={displayEndTime}
            onPreviousWeek={() => setWeekStart((current) => addDays(current, -7))}
            onNextWeek={() => setWeekStart((current) => addDays(current, 7))}
            onWeekDateChange={(value) => setWeekStart(startOfWeek(parseDateInput(value)))}
            onDisplayStartTimeChange={setDisplayStartTime}
            onDisplayEndTimeChange={setDisplayEndTime}
            onRefresh={onRefresh}
            selectedSlotKey={selectedSlotKey}
            isPlacing={isPlacing}
            selectedSessionDraft={
              selectedSessionId && moveDrafts[selectedSessionId] ? moveDrafts[selectedSessionId] : undefined
            }
            conflictSlotKeys={conflictSlotKeys}
            availableSlotKeys={availableSlotKeys}
            onSelectSlot={(key, slotRows) => {
              // Conflict resolution: clicking an available slot triggers move
              if (onClickAvailableSlot && availableSlotKeys?.has(key)) {
                const [day, startTime, endTime] = key.split("|");
                onClickAvailableSlot(day, startTime, endTime);
                return;
              }
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
          scheduleRunId={scheduleRunId}
          onRefresh={onRefresh}
          staffOptions={staffOptions}
        />
      </div>
    );
  }

  return (
    <>
      <TimetablePlanner
        rows={visibleRows}
        slots={slots}
        grouped={grouped}
        weekStart={weekStart}
        weekNumber={selectedWeekNumber}
        displayStartTime={displayStartTime}
        displayEndTime={displayEndTime}
        onPreviousWeek={() => setWeekStart((current) => addDays(current, -7))}
        onNextWeek={() => setWeekStart((current) => addDays(current, 7))}
        onWeekDateChange={(value) => setWeekStart(startOfWeek(parseDateInput(value)))}
        onDisplayStartTimeChange={setDisplayStartTime}
        onDisplayEndTimeChange={setDisplayEndTime}
        onRefresh={onRefresh}
      />

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
            {visibleRows.map((row) => (
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

function firstScheduledWeek(rows: ScheduledRow[]) {
  const weeks = rows
    .map((row) => row.start_week)
    .filter((week): week is number => typeof week === "number" && Number.isFinite(week) && week > 0);
  return weeks.length ? Math.min(...weeks) : 1;
}

function rowOccursInWeek(row: ScheduledRow, weekNumber: number) {
  if (row.start_week && weekNumber < row.start_week) return false;
  if (row.end_week && weekNumber > row.end_week) return false;

  const customWeeks = parseWeekList(row.custom_weeks);
  if (customWeeks.length > 0) {
    return customWeeks.includes(weekNumber);
  }

  const pattern = (row.week_pattern || "Weekly").trim().toLowerCase();
  if (pattern === "odd") return weekNumber % 2 === 1;
  if (pattern === "even") return weekNumber % 2 === 0;
  return true;
}

function parseWeekList(value: string | null) {
  if (!value) return [];
  return value
    .split(/[,\s;]+/)
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isFinite(item) && item > 0);
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

function parseDateInput(value: string) {
  const [year, month, day] = value.split("-").map((item) => Number.parseInt(item, 10));
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
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
  scheduleRunId,
  onRefresh,
  staffOptions,
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
  scheduleRunId?: number;
  onRefresh?: () => void;
  staffOptions: { id: string; name: string }[];
}) {
  const [sessionData, setSessionData] = useState<SessionRow | null>(null);
  const [savingDetails, setSavingDetails] = useState(false);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [isSessionDirty, setIsSessionDirty] = useState(false);

  useEffect(() => {
    if (row && scheduleRunId) {
      getSession(row.session_id)
        .then(setSessionData)
        .catch((err) => setErrorDetails(err.message));
    } else {
      setSessionData(null);
    }
  }, [row?.session_id, scheduleRunId]);

  const draft = row
    ? (moveDrafts[row.session_id] ?? {
        day: row.day,
        start_time: row.start_time,
        end_time: row.end_time,
        room_code: row.room,
      })
    : null;
  const rowDuration = row ? duration(row) : 0;
  const matchingSlots = (
    draft ? timeSlots.filter((slot) => slot.day === draft.day && slot.duration_minutes === rowDuration) : []
  )
    .filter((slot, index, self) => self.findIndex((s) => s.start_time === slot.start_time) === index)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  const updateMove = (patch: Partial<MoveDraft>) => {
    if (!draft || !row || !onChangeMove) return;
    const next = { ...draft, ...patch };
    const slot = timeSlots.find(
      (item) => item.day === next.day && item.start_time === next.start_time && item.duration_minutes === rowDuration,
    );
    if (slot) {
      next.end_time = slot.end_time;
    }
    onChangeMove(row.session_id, next);
  };

  const handleSaveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionData || !row || !scheduleRunId) return;
    setSavingDetails(true);
    setErrorDetails(null);
    try {
      if (isSessionDirty) {
        await updateSession(row.session_id, sessionData);
      }

      const hasDraft = !!moveDrafts[row.session_id];
      if (hasDraft && onSaveMove) {
        setIsPlacing?.(false);
        onSaveMove(row);
      } else {
        await recheckSchedule(scheduleRunId);
        onRefresh?.();
      }
    } catch (err) {
      setErrorDetails(err instanceof Error ? err.message : "Failed to save session");
      setSavingDetails(false);
    }
  };

  if (!row || !draft) {
    return (
      <section className="schedule-edit-panel selected-session-panel">
        <div className="empty-state">No sessions match the current filters.</div>
      </section>
    );
  }

  const isSaving = savingDetails || savingMove === row.session_id;

  return (
    <section className="schedule-edit-panel selected-session-panel">
      <div className="schedule-edit-heading">
        <div>
          <strong>Selected Session</strong>
          <span>Inspect or modify session details.</span>
        </div>
        <small>{row.requirement_id}</small>
      </div>
      <div className="selected-session-body">
        <div className="selected-session-main">
          <strong>{row.module_code ?? row.requirement_id}</strong>
          <span>
            {row.programme ?? "No programme"} | {row.class_type ?? "Class"} | {row.student_group_code ?? "No group"}
          </span>
          <small>{row.week_pattern ?? "Weeks not set"}</small>
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

        {scheduleRunId && sessionData && (
          <div className="move-controls">
            <div className="move-controls-header">
              <div>
                <strong>Edit & Move</strong>
                <span>Update requirements and placement</span>
              </div>
              <button
                className={`button slim ${isPlacing ? "primary" : "secondary"}`}
                onClick={() => setIsPlacing(!isPlacing)}
                type="button"
              >
                {isPlacing ? "Cancel Selection" : "Pick Time"}
              </button>
            </div>

            {errorDetails && (
              <div className="notice bad" style={{ margin: "0 16px 16px" }}>
                {errorDetails}
              </div>
            )}

            <div
              className="move-control-fields"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "12px",
                borderBottom: "1px solid var(--color-border)",
                paddingBottom: "16px",
                marginBottom: "16px",
              }}
            >
              <label className="move-field" style={{ gridColumn: "1 / -1" }}>
                <span
                  style={{
                    fontWeight: 600,
                    color: "var(--color-primary)",
                    textTransform: "uppercase",
                    fontSize: "11px",
                    letterSpacing: "0.5px",
                  }}
                >
                  Module Details
                </span>
              </label>

              <label className="move-field">
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
                <select
                  value={sessionData.scheduling_type ?? ""}
                  onChange={(e) => {
                    setSessionData({ ...sessionData, scheduling_type: e.target.value });
                    setIsSessionDirty(true);
                  }}
                >
                  <option value="">-- Select --</option>
                  <option value="Standard">Standard</option>
                  <option value="Fixed">Fixed</option>
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
            </div>

            <div
              className="move-control-fields"
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}
            >
              <label className="move-field" style={{ gridColumn: "1 / -1" }}>
                <span
                  style={{
                    fontWeight: 600,
                    color: "var(--color-primary)",
                    textTransform: "uppercase",
                    fontSize: "11px",
                    letterSpacing: "0.5px",
                  }}
                >
                  Placement
                </span>
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

              <label className="move-field" style={{ gridColumn: "1 / -1" }}>
                <span>Room</span>
                <input
                  list={`room-options-${row.session_id}`}
                  value={draft.room_code}
                  onChange={(e) => updateMove({ room_code: e.target.value })}
                  placeholder="Leave empty to auto-assign"
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

            <button
              className="button primary"
              disabled={isSaving}
              onClick={handleSaveAll}
              style={{ marginTop: "16px", width: "100%", justifyContent: "center" }}
            >
              {isSaving ? "Saving Changes..." : "Save All Changes"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
