/*
 * Validation page.
 * Shows saved requirement errors/warnings and schedule issue breakdowns.
 */

import { RefreshCw, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { getValidation } from "../api/client";
import StatusBadge from "../components/StatusBadge";
import ValidationTable from "../components/ValidationTable";
import IssueBreakdown from "../components/IssueBreakdown";
import type { ValidationResult } from "../types";

export default function ValidationPage() {
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    getValidation().then(setValidation).catch((err: Error) => setError(err.message));
  };

  useEffect(load, []);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Validation</h1>
          <p>Input quality checks</p>
        </div>
        <button className="button secondary" onClick={load}>
          <RefreshCw size={17} />
          Refresh
        </button>
      </div>
      {error && <div className="notice bad">{error}</div>}
      {validation && (
        <>
          <div className="status-row">
            <StatusBadge label={validation.is_valid ? "Valid" : "Invalid"} tone={validation.is_valid ? "good" : "bad"} />
            <span>{validation.error_count} errors</span>
            <span>{validation.warning_count} warnings</span>
            <span title={"Input validation checks uploaded session data for missing or invalid fields. Schedule issues are constraint violations detected after generating a timetable (conflicts in scheduled sessions)."} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
              <Info size={14} />
            </span>
          </div>
          <ValidationTable errors={validation.errors} warnings={validation.warnings} />
          <div style={{ marginTop: 24 }}>
            <IssueBreakdown scheduleIssues={validation.schedule_issues} />
          </div>
        </>
      )}
    </div>
  );
}
