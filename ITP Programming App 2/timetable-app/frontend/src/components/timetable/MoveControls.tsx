import type { Room, ScheduledRow, TimeSlot } from "../../types";
import { days, type MoveDraft } from "./types";
import { duration } from "./timetableUtils";

type Props = {
  row: ScheduledRow;
  rooms: Room[];
  timeSlots: TimeSlot[];
  value?: MoveDraft;
  saving: boolean;
  onChange: (value: MoveDraft) => void;
  onSave: () => void;
  isPlacing?: boolean;
  setIsPlacing?: (value: boolean) => void;
};

export default function MoveControls({
  row,
  rooms,
  timeSlots,
  value,
  saving,
  onChange,
  onSave,
  isPlacing,
  setIsPlacing,
}: Props) {
  const draft = value ?? { day: row.day, start_time: row.start_time, end_time: row.end_time, room_code: row.room };
  const rowDuration = duration(row);
  const matchingSlots = timeSlots.filter((slot) => slot.day === draft.day && slot.duration_minutes === rowDuration);

  const update = (patch: Partial<MoveDraft>) => {
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
      <div className="move-controls-header">
        <div>
          <strong>Move session</strong>
          <span>
            {draft.day}, {draft.start_time}-{draft.end_time}
          </span>
        </div>
        {setIsPlacing && (
          <button
            className={`button slim ${isPlacing ? "primary" : "secondary"}`}
            onClick={() => setIsPlacing(!isPlacing)}
            type="button"
          >
            {isPlacing ? "Cancel Selection" : "Pick Time"}
          </button>
        )}
      </div>
      <div className="move-control-fields">
        <label className="move-field">
          <span>Day</span>
          <select value={draft.day} onChange={(event) => update({ day: event.target.value })}>
            {days.map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </select>
        </label>
        <label className="move-field">
          <span>Time</span>
          <select value={draft.start_time} onChange={(event) => update({ start_time: event.target.value })}>
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
            onChange={(event) => update({ room_code: event.target.value })}
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
        className="button primary slim"
        disabled={saving}
        type="button"
        onClick={() => {
          setIsPlacing?.(false);
          onSave();
        }}
      >
        {saving ? "Saving" : "Save Move"}
      </button>
    </div>
  );
}
