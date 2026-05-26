/*
 * Generate page.
 * Blocks schedule generation when saved requirements have validation errors.
 */

import { Play, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { generateSchedule, getValidation } from "../api/client";
import StatusBadge from "../components/StatusBadge";
import ValidationTable from "../components/ValidationTable";
import { notifyWorkflowProgressChange } from "../components/WorkflowProgress";
import type { ScheduleGenerateResult, ValidationResult } from "../types";

export default function GenerateSchedulePage() {
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [result, setResult] = useState<ScheduleGenerateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadValidation = () => {
    getValidation().then(setValidation).catch((err: Error) => setError(err.message));
  };

  useEffect(loadValidation, []);

  const handleGenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await generateSchedule());
      notifyWorkflowProgressChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  };

  const blocked = !!validation && validation.error_count > 0;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Generate</h1>
          <p>CP-SAT timetable run</p>
        </div>
        <button className="button secondary" onClick={loadValidation}>
          <RefreshCw size={17} />
          Refresh
        </button>
      </div>

      {validation && (
        <div className="status-row">
          <StatusBadge label={validation.is_valid ? "Validation clear" : "Validation blocked"} tone={validation.is_valid ? "good" : "bad"} />
          <span>{validation.error_count} errors</span>
          <span>{validation.warning_count} warnings</span>
        </div>
      )}

      <button className="button large" disabled={busy || blocked || !validation} onClick={handleGenerate}>
        <Play size={18} />
        {busy ? "Running solver" : "Generate schedule"}
      </button>

      {error && <div className="notice bad">{error}</div>}
      {blocked && validation && <ValidationTable errors={validation.errors} warnings={[]} />}
      {result && (
        <section className="metric-grid compact">
          <div className="metric-card">
            <span>Run ID</span>
            <strong>{result.schedule_run_id}</strong>
          </div>
          <div className="metric-card">
            <span>Solver</span>
            <strong>{result.solver_status}</strong>
          </div>
          <div className="metric-card">
            <span>Hard conflicts</span>
            <strong>{result.hard_violation_count}</strong>
          </div>
          <div className="metric-card">
            <span>Soft score</span>
            <strong>{result.soft_score}</strong>
          </div>
        </section>
      )}
      {result && <div className="notice good">{result.message}</div>}
    </div>
  );
}
