/*
 * Validation page.
 * Shows saved requirement errors/warnings and schedule issue breakdowns.
 */

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { getValidation } from "../api/client";
import type { ValidationIssue, ValidationResult } from "../types";

const ISSUE_LABELS: Record<string, string> = {
  "Fixed Time": "Fixed session conflict",
};

function formatIssueType(field: string) {
  return ISSUE_LABELS[field] ?? field;
}

function labelForStatus(errorCount: number) {
  return errorCount === 0 ? "Clean: Ready to Generate" : `Attention Required: ${errorCount} Conflict${errorCount === 1 ? "" : "s"} Found`;
}

export default function ValidationPage() {
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeIssue, setActiveIssue] = useState<ValidationIssue | null>(null);

  const load = () => {
    getValidation().then(setValidation).catch((err: Error) => setError(err.message));
  };

  useEffect(load, []);

  const hasErrors = !!validation && validation.error_count > 0;
  const statusLabel = validation ? labelForStatus(validation.error_count) : "Loading validation...";

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Validation</h1>
          <p>Pre-generation pre-flight checklist</p>
        </div>
        <button className="button secondary" onClick={load}>
          <RefreshCw size={17} />
          Refresh
        </button>
      </div>

      {error && <div className="notice bad">{error}</div>}

      {validation && (
        <>
          <div className="status-board">
            <section className="status-card summary-card">
              <div className="status-card-title">Status</div>
              <div className={`status-card-badge ${hasErrors ? "bad" : "good"}`}>
                {hasErrors ? "🔴" : "🟢"}
                <span>{statusLabel}</span>
              </div>
              <p>{hasErrors ? "Fix all hard conflicts before generating the timetable." : "No hard validation conflicts detected. You may proceed to generate."}</p>
            </section>

            <section className="status-card issue-card">
              <div className="status-card-title">Issues found</div>
              {validation.errors.length === 0 ? (
                <div className="empty-state">No hard validation conflicts found.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Issue Type</th>
                        <th>Affected Requirement</th>
                        <th>Details</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validation.errors.map((item, index) => (
                        <tr key={`${item.row}-${item.field}-${index}`}>
                          <td>{formatIssueType(item.field)}</td>
                          <td>{item.requirement_id ?? `Row ${item.row}`}</td>
                          <td>{item.message}</td>
                          <td>
                            <button className="button secondary slim" onClick={() => setActiveIssue(item)}>
                              Quick Edit
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="status-card gate-card">
              <div className="status-card-title">Gatekeeper</div>
              <p>Generate only when all hard validation checks are clear.</p>
              <button className="button large" disabled={hasErrors} onClick={() => (window.location.hash = "#generate")}>Generate Timetable</button>
            </section>
          </div>

          {activeIssue && (
            <div className="modal-backdrop" role="dialog" aria-modal="true">
              <div className="modal-content quick-edit-panel">
                <div className="modal-header">
                  <div>
                    <h2>Quick Edit</h2>
                    <p>Review and fix the affected requirement row before generating.</p>
                  </div>
                  <button className="button secondary slim" type="button" onClick={() => setActiveIssue(null)}>
                    Close
                  </button>
                </div>
                <div className="modal-body">
                  <div className="detail-row">
                    <strong>Issue Type</strong>
                    <span>{formatIssueType(activeIssue.field)}</span>
                  </div>
                  <div className="detail-row">
                    <strong>Affected Requirement</strong>
                    <span>{activeIssue.requirement_id ?? `Row ${activeIssue.row}`}</span>
                  </div>
                  <div className="detail-row">
                    <strong>Details</strong>
                    <span>{activeIssue.message}</span>
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="button secondary" type="button" onClick={() => (window.location.hash = "#upload")}>Open Upload</button>
                  <button className="button" type="button" onClick={() => setActiveIssue(null)}>Close</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
