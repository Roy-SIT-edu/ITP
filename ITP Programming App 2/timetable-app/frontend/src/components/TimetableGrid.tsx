/*
 * Timetable grid for reviewing and manually adjusting generated scheduled sessions.
 */

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
  if (editable) {
    return (
      <div className="review-timetable-workspace">
        <div className="timetable-board-panel">
          <TimetableBoard rows={rows} />
        </div>
        <EditableSessionList
          rows={rows}
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
      <TimetableBoard rows={rows} />

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

function TimetableBoard({ rows }: { rows: ScheduledRow[] }) {
  return (
    <div className="timetable-board">
      {days.map((day) => (
        <section className="day-column" key={day}>
          <h3>{day}</h3>
          <div className="day-events">
            {rows.filter((row) => row.day === day).length === 0 && <span className="muted">No sessions</span>}
            {rows
              .filter((row) => row.day === day)
              .sort((left, right) => left.start_time.localeCompare(right.start_time))
              .map((row) => (
                <article
                  className={row.delivery_mode === "Online" || row.room.includes("VIRTUAL") ? "event virtual" : "event"}
                  key={`${row.requirement_id}-${row.day}-${row.start_time}-${row.room}`}
                >
                  <strong>{row.module_code ?? row.requirement_id}</strong>
                  <span>
                    {row.start_time}-{row.end_time} | {row.room}
                  </span>
                  <small>{row.student_group_code ?? "No group"} | {row.staff_name ?? "No staff"}</small>
                </article>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function EditableSessionList({
  rows,
  rooms,
  timeSlots,
  moveDrafts,
  savingMove,
  onChangeMove,
  onSaveMove,
}: {
  rows: ScheduledRow[];
  rooms: Room[];
  timeSlots: TimeSlot[];
  moveDrafts: Record<number, MoveDraft>;
  savingMove: number | null;
  onChangeMove?: (sessionId: number, value: MoveDraft) => void;
  onSaveMove?: (row: ScheduledRow) => void;
}) {
  return (
    <section className="schedule-edit-panel">
      <div className="schedule-edit-heading">
        <div>
          <strong>Edit Sessions</strong>
          <span>Move scheduled sessions without leaving the timetable.</span>
        </div>
        <small>{rows.length} shown</small>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">No sessions match the current filters.</div>
      ) : (
        <div className="schedule-edit-list">
          {rows.map((row) => (
            <article className="schedule-edit-card" key={`${row.requirement_id}-${row.day}-${row.start_time}-${row.room}`}>
              <div className="schedule-edit-main">
                <strong>{row.module_code ?? row.requirement_id}</strong>
                <span>
                  {row.programme ?? "No programme"} | {row.class_type ?? "Class"} | {row.student_group_code ?? "No group"}
                </span>
                <small>
                  {row.staff_name ?? "No staff"} | {row.day} {row.start_time}-{row.end_time} | {row.room}
                </small>
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
            </article>
          ))}
        </div>
      )}
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
        {matchingSlots.map((slot) => (
          <option key={`${slot.day}-${slot.start_time}-${slot.end_time}`} value={slot.start_time}>
            {slot.start_time}-{slot.end_time}
          </option>
        ))}
      </select>
      <select value={draft.room_code} onChange={(event) => update({ room_code: event.target.value })}>
        {rooms.map((room) => (
          <option key={room.id} value={room.room_code}>
            {room.room_code}
          </option>
        ))}
      </select>
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
