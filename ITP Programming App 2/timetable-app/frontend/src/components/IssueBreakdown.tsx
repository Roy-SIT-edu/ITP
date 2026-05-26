/*
 * Human-readable breakdown for post-generation schedule issues.
 */

import { useState } from "react";
import type { ValidationResult } from "../types";
import { getViolations } from "../api/client";
import type { ConstraintViolation } from "../types";
import StatusBadge from "./StatusBadge";

const FRIENDLY_NAMES: Record<string, string> = {
  ROOM_DOUBLE_BOOKING: "Room double booking",
  STAFF_DOUBLE_BOOKING: "Staff double booking",
  STUDENT_GROUP_DOUBLE_BOOKING: "Student group double booking",
  ROOM_CAPACITY_MISMATCH: "Room capacity mismatch",
  DELIVERY_ROOM_MISMATCH: "Delivery/room mismatch",
  INVALID_FIXED_TIME: "Fixed session scheduled incorrectly",
  TUTOR_IDLE_GAP: "Tutor idle gaps (>2hrs)",
  LONG_CONSECUTIVE_DAY: "Consecutive hours (>4)",
  SHORT_CAMPUS_DAY: "Short campus day (<=2hrs)",
  ONLINE_F2F_ADJACENT_SWITCH: "Online ↔ F2F adjacent switch",
  ONLINE_NOT_MON_TUE: "Online not on Mon/Tue",
};

export default function IssueBreakdown({ scheduleIssues }: { scheduleIssues: ValidationResult["schedule_issues"] | undefined }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [violations, setViolations] = useState<ConstraintViolation[]>([]);
  const [loading, setLoading] = useState(false);

  if (!scheduleIssues) return null;

  const breakdown = scheduleIssues.breakdown ?? [];
  const hard = breakdown.filter((b) => (b.severity || "").toUpperCase() === "HARD");
  const soft = breakdown.filter((b) => (b.severity || "").toUpperCase() === "SOFT");

  const expand = async (code: string) => {
    if (expanded === code) {
      setExpanded(null);
      return;
    }
    setLoading(true);
    setExpanded(code);
    try {
      if (!scheduleIssues.schedule_run_id) {
        setViolations([]);
        setLoading(false);
        return;
      }
      const all = await getViolations(scheduleIssues.schedule_run_id);
      setViolations(all.filter((v: ConstraintViolation) => v.constraint_code === code));
    } catch (err) {
      setViolations([]);
    }
    setLoading(false);
  };

  return (
    <div>
      <h2>Schedule Issues</h2>
      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ height: 12, background: "#e6f6ea", borderRadius: 6, overflow: "hidden" }}>
            {scheduleIssues.total === 0 ? (
              <div style={{ height: "100%", background: "#2ecc71", width: "100%" }} />
            ) : (
              <div style={{ display: "flex", height: "100%" }}>
                <div style={{ background: "#e74c3c", width: `${(scheduleIssues.hard_count / Math.max(1, scheduleIssues.total)) * 100}%` }} />
                <div style={{ background: "#f39c12", width: `${(scheduleIssues.soft_count / Math.max(1, scheduleIssues.total)) * 100}%` }} />
              </div>
            )}
          </div>
        </div>
        <div style={{ minWidth: 220, display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 12, height: 12, background: "#e74c3c", display: "inline-block", borderRadius: 2 }} />
            <small>Hard: {scheduleIssues.hard_count}</small>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 12, height: 12, background: "#f39c12", display: "inline-block", borderRadius: 2 }} />
            <small>Soft: {scheduleIssues.soft_count}</small>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 12, height: 12, background: "#2ecc71", display: "inline-block", borderRadius: 2 }} />
            <small>Total: {scheduleIssues.total}</small>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h3>Hard Constraints</h3>
          <div>
            {[
              "ROOM_DOUBLE_BOOKING",
              "STAFF_DOUBLE_BOOKING",
              "STUDENT_GROUP_DOUBLE_BOOKING",
              "ROOM_CAPACITY_MISMATCH",
              "DELIVERY_ROOM_MISMATCH",
              "INVALID_FIXED_TIME",
            ].map((code) => {
              const entry = hard.find((b) => b.constraint_code === code);
              const count = entry ? entry.count : 0;
              const ok = count === 0;
              return (
                <div key={code} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <StatusBadge label={ok ? "OK" : "Issue"} tone={ok ? "good" : "bad"} />
                    <strong>{FRIENDLY_NAMES[code] ?? code}</strong>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span>{count}</span>
                    <button className="button secondary slim" onClick={() => expand(code)}>{expanded === code ? "Hide" : "List"}</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <h3>Soft Constraints</h3>
          <div>
            {[
              "TUTOR_IDLE_GAP",
              "LONG_CONSECUTIVE_DAY",
              "SHORT_CAMPUS_DAY",
              "ONLINE_F2F_ADJACENT_SWITCH",
              "ONLINE_NOT_MON_TUE",
            ].map((code) => {
              const entry = soft.find((b) => b.constraint_code === code);
              const count = entry ? entry.count : 0;
              return (
                <div key={code} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <StatusBadge label={"Soft"} tone={count === 0 ? "good" : "warn"} />
                    <strong>{FRIENDLY_NAMES[code] ?? code}</strong>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span>{count}</span>
                    <button className="button secondary slim" onClick={() => expand(code)}>{expanded === code ? "Hide" : "List"}</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        {loading && <div className="empty-state">Loading violations…</div>}
        {!loading && expanded && (
          <div>
            <h4>Violations for {FRIENDLY_NAMES[expanded] ?? expanded}</h4>
            {violations.length === 0 ? (
              <div className="empty-state">No violations found for this code.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Severity</th>
                      <th>Message</th>
                      <th>Affected Sessions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {violations.map((v) => (
                      <tr key={v.id}>
                        <td>
                          <StatusBadge label={v.severity} tone={v.severity === "HARD" ? "bad" : "warn"} />
                        </td>
                        <td>{v.message}</td>
                        <td>{v.affected_session_ids.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
