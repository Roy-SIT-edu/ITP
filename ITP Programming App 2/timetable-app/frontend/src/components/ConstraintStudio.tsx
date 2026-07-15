import { useEffect, useState } from "react";
import type { SessionRow } from "../types";

export type ConstraintPresetValues = {
  mode: "none" | "soft";
  preferred_days: string;
  avoid_days: string;
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
  const [sessionQuery, setSessionQuery] = useState("");
  const [mode, setMode] = useState<ConstraintPresetValues["mode"]>("soft");
  const [preferredDays, setPreferredDays] = useState("Monday,Tuesday");
  const [avoidDays, setAvoidDays] = useState("Friday");

  const selected = typeof sessionId === "number" ? sessions.find((item) => item.id === sessionId) : null;

  useEffect(() => {
    if (!selected) return;
    setPreferredDays(selected.preferred_days || "Monday,Tuesday");
    setAvoidDays(selected.avoid_days || "");
    setMode(selected.preferred_days || selected.avoid_days ? "soft" : "none");
    setSessionQuery(requirementLabel(selected));
  }, [selected]);

  return (
    <section className="status-card constraint-studio">
      <div className="status-card-title">Constraint Builder</div>
      <div className="constraint-grid">
        <label>
          Requirement
          <input
            list="constraint-requirement-options"
            placeholder="Search requirement"
            value={sessionQuery}
            onChange={(event) => {
              const value = event.target.value;
              setSessionQuery(value);
              const match = sessions.find((session) => requirementLabel(session) === value);
              setSessionId(match ? match.id : "");
            }}
          />
          <datalist id="constraint-requirement-options">
            {sessions.map((session) => (
              <option key={session.id} value={requirementLabel(session)} />
            ))}
          </datalist>
        </label>
        <label>
          Mode
          <select value={mode} onChange={(event) => setMode(event.target.value as ConstraintPresetValues["mode"])}>
            <option value="none">No constraints</option>
            <option value="soft">Soft preferences</option>
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
          })
        }
      >
        Apply Constraints
      </button>
    </section>
  );
}

function requirementLabel(session: SessionRow) {
  return `${session.requirement_id ?? `Row ${session.source_row_no ?? session.id}`} - ${session.module_code}`;
}
