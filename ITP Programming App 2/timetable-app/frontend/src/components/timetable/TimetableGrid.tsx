import { useEffect, useMemo, useRef, useState } from "react";
import type { Room, ScheduledRow, TimeSlot, SessionRow } from "../../types";
import MoveControls from "./MoveControls";
import TimetablePlanner from "./TimetablePlanner";
import { days, type MoveDraft } from "./types";
import { buildPlannerSlots, duration, getFirstOverlapKey, groupRowsBySlot, timeToMinutes } from "./timetableUtils";
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
  softAvailableSlotKeys?: Set<string>;
  blockedSlotKeys?: Set<string>;
  onClickAvailableSlot?: (day: string, startTime: string, endTime: string) => void;
  onBlockedSlot?: (message: string) => void;
  onSelectSession?: (sessionId: number | null) => void;
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
  softAvailableSlotKeys = new Set(),
  blockedSlotKeys = new Set(),
  onClickAvailableSlot,
  onBlockedSlot,
  onSelectSession,
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
  const [selectedRowsOverride, setSelectedRowsOverride] = useState<ScheduledRow[] | null>(null);
  const [slotDetailsAttention, setSlotDetailsAttention] = useState(0);
  const [isPlacing, setIsPlacing] = useState(false);
  const selectedRow = useMemo(
    () => visibleRows.find((row) => row.session_id === selectedSessionId) ?? visibleRows[0] ?? null,
    [visibleRows, selectedSessionId],
  );
  const selectedSlotRows = useMemo(
    () => selectedRowsOverride ?? grouped.get(selectedSlotKey ?? "") ?? [],
    [grouped, selectedRowsOverride, selectedSlotKey],
  );

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
      setSelectedRowsOverride(null);
      return;
    }
    if (!visibleRows.some((row) => row.session_id === selectedSessionId)) {
      setSelectedSessionId(visibleRows[0].session_id);
    }
    if (!selectedSlotKey || !grouped.has(selectedSlotKey)) {
      setSelectedSlotKey(getFirstOverlapKey(visibleRows[0], slots));
      setSelectedRowsOverride(null);
    }
  }, [grouped, visibleRows, selectedSessionId, selectedSlotKey, slots]);

  useEffect(() => {
    if (
      selectedRowsOverride &&
      selectedRowsOverride.some((row) => !visibleRows.some((visibleRow) => visibleRow.session_id === row.session_id))
    ) {
      setSelectedRowsOverride(null);
    }
  }, [selectedRowsOverride, visibleRows]);

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
            softAvailableSlotKeys={softAvailableSlotKeys}
            blockedSlotKeys={blockedSlotKeys}
            onSelectSlot={(key, slotRows, options) => {
              if (blockedSlotKeys?.has(key) && (isPlacing || slotRows.length === 0)) {
                onBlockedSlot?.("Cannot move here: this slot creates a hard conflict.");
                return;
              }
              if (options?.focusSlotDetails && slotRows.length > 0) {
                setSelectedSlotKey(key);
                setSelectedRowsOverride(slotRows);
                setSelectedSessionId(slotRows[0].session_id);
                onSelectSession?.(slotRows[0].session_id);
                setSlotDetailsAttention((current) => current + 1);
                return;
              }
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
                setSelectedRowsOverride(null);
                return;
              }
              if (slotRows.length > 0) {
                setSelectedSlotKey(key);
                setSelectedRowsOverride(slotRows);
                setSelectedSessionId(slotRows[0].session_id);
                onSelectSession?.(slotRows[0].session_id);
              }
            }}
          />
        </div>
        <SlotSessionList
          attentionKey={slotDetailsAttention}
          rows={selectedSlotRows}
          selectedSessionId={selectedRow?.session_id ?? null}
          onSelect={(sessionId) => {
            setSelectedSessionId(sessionId);
            onSelectSession?.(sessionId);
          }}
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
          onSelectSession={onSelectSession}
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
              <th>Source</th>
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
                <td>
                  {isLabRequirement(row) ? (
                    <span className="lab-source-badge">Lab requirement</span>
                  ) : (
                    <span className="source-badge">Uploaded</span>
                  )}
                </td>
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
  attentionKey,
  rows,
  selectedSessionId,
  onSelect,
}: {
  attentionKey: number;
  rows: ScheduledRow[];
  selectedSessionId: number | null;
  onSelect: (sessionId: number) => void;
}) {
  const label = rows.length > 0 ? slotRowsLabel(rows) : "No slot selected";
  const panelRef = useRef<HTMLElement | null>(null);
  const [isHighlighted, setIsHighlighted] = useState(false);

  useEffect(() => {
    if (attentionKey <= 0) return;
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setIsHighlighted(true);
    const timeout = window.setTimeout(() => setIsHighlighted(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [attentionKey]);

  return (
    <section className={`slot-detail-panel ${isHighlighted ? "attention" : ""}`} ref={panelRef}>
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
                className={`slot-session-card ${isLabRequirement(row) ? "lab-requirement" : ""} ${
                  selectedSessionId === row.session_id ? "selected" : ""
                }`}
                key={row.session_id}
                onClick={() => onSelect(row.session_id)}
                type="button"
              >
                {isLabRequirement(row) && <span className="lab-source-badge">Lab requirement</span>}
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

function slotRowsLabel(rows: ScheduledRow[]) {
  const day = rows[0].day;
  const start = rows.reduce(
    (earliest, row) => (timeToMinutes(row.start_time) < timeToMinutes(earliest) ? row.start_time : earliest),
    rows[0].start_time,
  );
  const end = rows.reduce(
    (latest, row) => (timeToMinutes(row.end_time) > timeToMinutes(latest) ? row.end_time : latest),
    rows[0].end_time,
  );
  return `${day}, ${start}-${end}`;
}

function isLabRequirement(row: ScheduledRow) {
  return row.is_lab_requirement === true || (row.requirement_id ?? "").startsWith("LAB-");
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
  onSelectSession,
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
  onSelectSession?: (sessionId: number | null) => void;
}) {
  const [sessionData, setSessionData] = useState<SessionRow | null>(null);
  const [savingDetails, setSavingDetails] = useState(false);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [isSessionDirty, setIsSessionDirty] = useState(false);
  const rowSessionId = row?.session_id ?? null;

  useEffect(() => {
    if (rowSessionId && scheduleRunId) {
      getSession(rowSessionId)
        .then(setSessionData)
        .catch((err) => setErrorDetails(err.message));
    } else {
      setSessionData(null);
    }
  }, [rowSessionId, scheduleRunId]);

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
        <strong>Selected Session</strong>
        <small>{isLabRequirement(row) ? `Lab requirement ${row.requirement_id}` : row.requirement_id}</small>
      </div>
      <div className="selected-session-body">
        <div className="selected-session-overview">
          <div className="selected-session-main">
            {isLabRequirement(row) && <span className="lab-source-badge">Built-in lab requirement</span>}
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
        </div>

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
      </div>
    </section>
  );
}
