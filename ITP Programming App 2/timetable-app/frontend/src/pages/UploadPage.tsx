/*
 * Import page.
 * Keeps the first screen focused on selecting and importing requirements files.
 */

import { useState } from "react";
import { resetRequirementInputs, uploadTemplate } from "../api/client";
import { formatApiError } from "../api/errors";
import ImportSummary from "../components/ImportSummary";
import UploadBox from "../components/UploadBox";
import { notifyWorkflowProgressChange } from "../components/WorkflowProgress";
import { clearSessionState, useSessionState } from "../sessionState";
import type { UploadSummary } from "../types";

export default function UploadPage() {
  const [summary, setSummary] = useSessionState<UploadSummary | null>("upload.summary", null);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [error, setError] = useSessionState<string | null>("upload.error", null);
  const [success, setSuccess] = useSessionState<string | null>("upload.success", null);

  const handleUpload = async (files: File[]) => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const nextSummary = await uploadTemplate(files);
      if (nextSummary.rows_failed > 0) {
        setSummary(nextSummary);
        setError("No requirements were imported because validation failed. Fix the row-level errors below and upload again.");
      } else {
        clearSessionState();
        setSummary(nextSummary);
        setResetSignal((current) => current + 1);
        setSuccess(`${nextSummary.rows_imported} requirement${nextSummary.rows_imported === 1 ? "" : "s"} imported.`);
        notifyWorkflowProgressChange();
      }
    } catch (err) {
      setError(formatApiError(err, "Upload failed"));
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm("Clear all imported requirements and generated timetable data?")) return;
    setResetting(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await resetRequirementInputs();
      clearSessionState();
      setSummary(null);
      setError(null);
      setSuccess(`${result.rows_deleted} requirement${result.rows_deleted === 1 ? "" : "s"} cleared.`);
      setResetSignal((current) => current + 1);
      notifyWorkflowProgressChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Import Data</h1>
          <p>Select one or more Excel input files. Imported rows replace the current requirement set.</p>
        </div>
        <div className="toolbar-row">
          <button className="button secondary" type="button" onClick={handleReset} disabled={busy || resetting}>
            {resetting ? "Clearing" : "Reset Input"}
          </button>
        </div>
      </div>

      <section className="status-card">
        <div className="section-heading">
          <div>
            <div className="status-card-title">Input Files</div>
            <p>Use Excel workbooks with the Input_Template sheet. After import, validate the data before ranking priorities.</p>
          </div>
        </div>
        <UploadBox busy={busy} onUpload={handleUpload} resetSignal={resetSignal} />
      </section>
      {error && <div className="notice bad">{error}</div>}
      {success && <div className="notice good">{success}</div>}
      {summary && <ImportSummary summary={summary} />}
    </div>
  );
}
