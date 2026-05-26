/*
 * Displays row-level validation errors and warnings from the backend.
 */

import type { ValidationIssue } from "../types";
import StatusBadge from "./StatusBadge";

type Props = {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

export default function ValidationTable({ errors, warnings }: Props) {
  const rows = [
    ...errors.map((item) => ({ ...item, severity: "Error" as const })),
    ...warnings.map((item) => ({ ...item, severity: "Warning" as const })),
  ];

  if (rows.length === 0) {
    return <div className="empty-state">No validation issues found.</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Severity</th>
            <th>Row</th>
            <th>Field</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, index) => (
            <tr key={`${item.severity}-${item.row}-${item.field}-${index}`}>
              <td>
                <StatusBadge label={item.severity} tone={item.severity === "Error" ? "bad" : "warn"} />
              </td>
              <td>{item.row}</td>
              <td>{item.field}</td>
              <td>{item.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
