import type { ConstraintViolation } from "../types";
import StatusBadge from "./StatusBadge";

type Props = {
  violations: ConstraintViolation[];
};

export default function ConflictTable({ violations }: Props) {
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
            <tr key={item.id}>
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
