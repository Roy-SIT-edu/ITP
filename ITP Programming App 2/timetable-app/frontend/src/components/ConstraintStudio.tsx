import { useEffect, useState } from "react";
import type { SessionRow } from "../types";

export type ConstraintPresetValues = {
  mode: "none" | "soft" | "hard";
  preferred_days: string;
  avoid_days: string;
  fixed_day: string;
  fixed_start_time: string;
  fixed_end_time: string;
};

export default function ConstraintStudio({
  sessions,
  disabled,
  onApply,
}: {
  sessions: SessionRow[];
  disabled: boolean;
  onApply: (sessionId: number, values: ConstraintPresetValues) => void;
}) {
  const [sessionId, setSessionId] = useState<number | "">("");
  const [mode, setMode] = useState<ConstraintPresetValues["mode"]>("soft");
  const [preferredDays, setPreferredDays] = useState("Monday,Tuesday");
  const [avoidDays, setAvoidDays] = useState("Friday");
  const [fixedDay, setFixedDay] = useState("Monday");
  const [fixedStart, setFixedStart] = useState("09:00");
  const [fixedEnd, setFixedEnd] = useState("11:00");

  const selected = typeof sessionId === "number" ? sessions.find((item) => item.id === sessionId) : null;

  useEffect(() => {
    if (!selected) return;
    setPreferredDays(selected.preferred_days || "Monday,Tuesday");
    setAvoidDays(selected.avoid_days || "");
    setFixedDay(selected.fixed_day || "Monday");
    setFixedStart(selected.fixed_start_time || "09:00");
    setFixedEnd(selected.fixed_end_time || "11:00");
    setMode(selected.scheduling_type === "Fixed" ? "hard" : selected.preferred_days || selected.avoid_days ? "soft" : "none");
  }, [selected?.id]);

  return (
    <section className="status-card constraint-studio">
      <div className="status-card-title">Constraint Builder</div>
      <div className="constraint-grid">
        <label>
          Requirement
          <select value={sessionId} onChange={(event) => setSessionId(event.target.value ? Number(event.target.value) : "")}>
            <option value="">Select requirement</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.requirement_id ?? `Row ${session.source_row_no ?? session.id}`} - {session.module_code}
              </option>
            ))}
          </select>
        </label>
        <label>
          Mode
          <select value={mode} onChange={(event) => setMode(event.target.value as ConstraintPresetValues["mode"])}>
            <option value="none">No constraints</option>
            <option value="soft">Soft preferences</option>
            <option value="hard">Hard fixed slot</option>
          </select>
        </label>
        {mode === "soft" && (
          <>
            <label>
              Preferred Days
              <input value={preferredDays} onChange={(event) => setPreferredDays(event.target.value)} />
            </label>
            <label>
              Avoid Days
              <input value={avoidDays} onChange={(event) => setAvoidDays(event.target.value)} />
            </label>
          </>
        )}
        {mode === "hard" && (
          <>
            <label>
              Fixed Day
              <select value={fixedDay} onChange={(event) => setFixedDay(event.target.value)}>
                {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Fixed Start
              <input type="time" value={fixedStart} onChange={(event) => setFixedStart(event.target.value)} />
            </label>
            <label>
              Fixed End
              <input type="time" value={fixedEnd} onChange={(event) => setFixedEnd(event.target.value)} />
            </label>
          </>
        )}
      </div>
      <button
        className="button"
        disabled={disabled || typeof sessionId !== "number"}
        type="button"
        onClick={() =>
          typeof sessionId === "number" &&
          onApply(sessionId, {
            mode,
            preferred_days: preferredDays,
            avoid_days: avoidDays,
            fixed_day: fixedDay,
            fixed_start_time: fixedStart,
            fixed_end_time: fixedEnd,
          })
        }
      >
        Apply Constraints
      </button>
    </section>
  );
}
