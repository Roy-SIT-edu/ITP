import StatusBadge from "../StatusBadge";
import type { ValidationIssue, ValidationResult } from "../../types";
import type { ValidationIssueRow } from "./types";
import { formatIssueType } from "./validationDisplay";

type Props = {
  hasValidated: boolean;
  hasErrors: boolean;
  validation: ValidationResult | null;
  statusLabel: string;
  issueRows: ValidationIssueRow[];
  onQuickEdit: (item: ValidationIssue) => void;
};

export default function ValidationStatusBoard({
  hasValidated,
  hasErrors,
  validation,
  statusLabel,
  issueRows,
  onQuickEdit,
}: Props) {
  return (
    <div className="status-board">
      <section className="status-card summary-card">
        <div className="status-card-title">Status</div>
        <div className="status-row">
          <StatusBadge
            label={!hasValidated ? "Not validated" : hasErrors ? "Blocked" : "Ready"}
            tone={!hasValidated ? "neutral" : hasErrors ? "bad" : "good"}
          />
          <span>{statusLabel}</span>
          {hasValidated && validation && <span>{validation.error_count} hard errors</span>}
        </div>
        <p>
          {!hasValidated
            ? "Run validation to reveal hard blockers such as missing fields, impossible rooms, and fixed-time clashes."
            : hasErrors
              ? "Fix all hard conflicts before generating the timetable."
              : "No hard validation conflicts detected. You may proceed to generate."}
        </p>
      </section>

      <section className="status-card issue-card">
        <div className="status-card-title">Hard conflicts found</div>
        {!hasValidated ? (
          <div className="empty-state">Click Validate to run hard-constraint checks and show conflicts.</div>
        ) : issueRows.length === 0 ? (
          <div className="empty-state">No hard validation conflicts found.</div>
        ) : (
          <div className="table-wrap validation-table-wrap">
            <table className="validation-issue-table">
              <colgroup>
                <col className="validation-severity-col" />
                <col className="validation-type-col" />
                <col className="validation-requirement-col" />
                <col />
                <col className="validation-action-col" />
              </colgroup>
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Issue Type</th>
                  <th>Affected Requirement</th>
                  <th>Details</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {issueRows.map((item, index) => (
                  <tr key={`${item.level}-${item.row}-${item.field}-${index}`}>
                    <td>
                      <StatusBadge label={item.level} tone="bad" />
                    </td>
                    <td>{formatIssueType(item.field)}</td>
                    <td>{item.requirement_id ?? `Row ${item.row}`}</td>
                    <td>{item.message}</td>
                    <td>
                      {item.conflict_session_ids?.length ? (
                        <button className="button secondary slim" type="button" onClick={() => onQuickEdit(item)}>
                          Quick Edit
                        </button>
                      ) : (
                        <button
                          className="button secondary slim"
                          type="button"
                          onClick={() =>
                            document
                              .getElementById("requirements-editor")
                              ?.scrollIntoView({ behavior: "smooth", block: "start" })
                          }
                        >
                          Edit Below
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="status-card gate-card">
        <div className="status-card-title">Next step</div>
        <p>After hard validation passes, generate the timetable. Soft priority ranking is available in Settings.</p>
        <a
          className={`button large ${hasValidated && validation?.error_count === 0 ? "" : "disabled-link"}`}
          href="#soft-constraints"
        >
          Generate Timetable
        </a>
      </section>
    </div>
  );
}
