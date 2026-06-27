/*
 * Displays hard and soft schedule constraint violations after generation.
 */

import type { ConstraintViolation } from "../types";
import StatusBadge from "./StatusBadge";

type Props = {
  violations: ConstraintViolation[];
  activeConflictId?: number | null;
  onSelectConflict?: (violation: ConstraintViolation) => void;
};

export default function ConflictTable({ violations, activeConflictId, onSelectConflict }: Props) {
  if (violations.length === 0) {
    return <div className="empty-state">No generated timetable conflicts found.</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Severity</th>
            <th>Code</th>
            <th>Message</th>
            <th>Sessions</th>
          </tr>
        </thead>
        <tbody>
          {violations.map((item) => (
            <tr
              key={item.id}
              className={item.id === activeConflictId ? "conflict-active-row" : ""}
              style={{ cursor: onSelectConflict ? "pointer" : "default" }}
              onClick={() => onSelectConflict?.(item)}
            >
              <td>
                <StatusBadge label={item.severity} tone={item.severity === "HARD" ? "bad" : "warn"} />
              </td>
              <td>{item.constraint_code}</td>
              <td>{item.message}</td>
              <td>{item.affected_session_ids.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
