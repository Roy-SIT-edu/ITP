/*
 * Validation page.
 * Shows saved requirement errors/warnings and schedule issue breakdowns.
 */

<<<<<<< Updated upstream
import { RefreshCw, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { getValidation } from "../api/client";
import StatusBadge from "../components/StatusBadge";
import ValidationTable from "../components/ValidationTable";
import IssueBreakdown from "../components/IssueBreakdown";
import type { ValidationResult } from "../types";
=======
import { Play, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  generateSchedule,
  getValidation,
  getSession,
  getTimeSlots,
  updateSession,
  ApiError,
} from "../api/client";
import { notifyWorkflowProgressChange } from "../components/WorkflowProgress";
import type { ScheduleGenerateResult, SessionRow, TimeSlot, ValidationIssue, ValidationResult } from "../types";

const ISSUE_LABELS: Record<string, string> = {
  "Fixed Time": "Fixed session conflict",
};

function formatIssueType(field: string) {
  return ISSUE_LABELS[field] ?? field;
}

function labelForStatus(errorCount: number) {
  return errorCount === 0 ? "Clean: Ready to Generate" : `Attention Required: ${errorCount} Conflict${errorCount === 1 ? "" : "s"} Found`;
}
>>>>>>> Stashed changes

export default function ValidationPage() {
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
<<<<<<< Updated upstream
=======
  const [activeIssue, setActiveIssue] = useState<ValidationIssue | null>(null);
  const [conflictSessions, setConflictSessions] = useState<{ anchor?: SessionRow; target?: SessionRow } | null>(null);
  const [timeslots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [editValues, setEditValues] = useState({
    fixed_day: "",
    fixed_start_time: "",
    fixed_end_time: "",
    scheduling_type: "Flexible",
    student_group_code: "",
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationResult, setGenerationResult] = useState<ScheduleGenerateResult | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
>>>>>>> Stashed changes

  const load = () => {
    getValidation().then(setValidation).catch((err: Error) => setError(err.message));
  };

<<<<<<< Updated upstream
  useEffect(load, []);
=======
  useEffect(() => {
    loadValidation();
    getTimeSlots().then(setTimeSlots).catch(() => setTimeSlots([]));
  }, []);

  const hasErrors = !!validation && validation.error_count > 0;
  const statusLabel = validation ? labelForStatus(validation.error_count) : "Loading validation...";

  const dayOptions = useMemo(() => Array.from(new Set(timeslots.map((slot) => slot.day))), [timeslots]);
  const startTimeOptions = useMemo(() => {
    if (!editValues.fixed_day) {
      return Array.from(new Set(timeslots.map((slot) => slot.start_time))).sort();
    }
    return Array.from(
      new Set(
        timeslots
          .filter((slot) => slot.day === editValues.fixed_day)
          .map((slot) => slot.start_time),
      ),
    ).sort();
  }, [timeslots, editValues.fixed_day]);

  const endTimeOptions = useMemo(() => {
    if (!editValues.fixed_day || !editValues.fixed_start_time) {
      return Array.from(new Set(timeslots.map((slot) => slot.end_time))).sort();
    }
    return Array.from(
      new Set(
        timeslots
          .filter((slot) => slot.day === editValues.fixed_day && slot.start_time === editValues.fixed_start_time)
          .map((slot) => slot.end_time),
      ),
    ).sort();
  }, [timeslots, editValues.fixed_day, editValues.fixed_start_time]);

  const closeQuickEdit = () => {
    setActiveIssue(null);
    setConflictSessions(null);
    setSaveError(null);
    setIsSaving(false);
    setEditValues({ fixed_day: "", fixed_start_time: "", fixed_end_time: "", scheduling_type: "Flexible", student_group_code: "" });
  };

  const openQuickEdit = async (item: ValidationIssue) => {
    setError(null);
    setSaveError(null);
    setActiveIssue(item);

    if (!item.conflict_session_ids?.length) {
      setConflictSessions(null);
      return;
    }

    try {
      const sessions = await Promise.all(item.conflict_session_ids.map(getSession));
      const target =
        sessions.find(
          (session) => session.requirement_id === item.requirement_id || session.source_row_no === item.row,
        ) ?? sessions[0];
      const anchor = sessions.find((session) => session.id !== target.id);
      setConflictSessions({ anchor, target });
      setEditValues({
        fixed_day: target.fixed_day ?? "",
        fixed_start_time: target.fixed_start_time ?? "",
        fixed_end_time: target.fixed_end_time ?? "",
        scheduling_type: target.scheduling_type ?? "Flexible",
        student_group_code: target.student_group_code ?? "",
      });
    } catch (err) {
      setSaveError("Unable to load conflicting rows for quick edit.");
    }
  };

  const saveQuickEdit = async () => {
    if (!conflictSessions?.target) {
      return;
    }
    setIsSaving(true);
    setSaveError(null);

    try {
      const payload: Partial<SessionRow> = {
        ...conflictSessions.target,
        fixed_day: editValues.fixed_day || null,
        fixed_start_time: editValues.fixed_start_time || null,
        fixed_end_time: editValues.fixed_end_time || null,
        scheduling_type: editValues.scheduling_type || null,
        student_group_code: editValues.student_group_code || null,
      };

      await updateSession(conflictSessions.target.id, payload);
      const refreshedValidation = await getValidation();
      setValidation(refreshedValidation);

      if (refreshedValidation.error_count === 0) {
        closeQuickEdit();
      } else {
        setSaveError("Saved. Validation still reports conflicts, please review the row again.");
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setSaveError(err.message);
      } else if (err instanceof Error) {
        setSaveError(err.message);
      } else {
        setSaveError("Unable to save changes.");
      }
    } finally {
      setIsSaving(false);
    }
  };
>>>>>>> Stashed changes

  const handleGenerate = async () => {
    setIsGenerating(true);
    setGenerationError(null);
    setGenerationResult(null);
    try {
      const result = await generateSchedule();
      setGenerationResult(result);
      setValidation(await getValidation());
      notifyWorkflowProgressChange();
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  };

  const quickSuggestions = useMemo(() => {
    if (!activeIssue) return [];
    const suggestions = [
      {
        label: "Make row flexible",
        detail: "Removes the fixed day/time so the solver can place this class around other requirements.",
        apply: () =>
          setEditValues((prev) => ({
            ...prev,
            scheduling_type: "Flexible",
            fixed_day: "",
            fixed_start_time: "",
            fixed_end_time: "",
          })),
      },
    ];
    const anchor = conflictSessions?.anchor;
    const candidate = timeslots.find(
      (slot) =>
        slot.duration_minutes === conflictSessions?.target?.duration_minutes &&
        (slot.day !== anchor?.fixed_day || slot.start_time !== anchor?.fixed_start_time || slot.end_time !== anchor?.fixed_end_time),
    );
    if (candidate) {
      suggestions.push({
        label: `Try ${candidate.day} ${candidate.start_time}-${candidate.end_time}`,
        detail: "Moves the editable row to another valid default time slot.",
        apply: () =>
          setEditValues((prev) => ({
            ...prev,
            scheduling_type: "Fixed",
            fixed_day: candidate.day,
            fixed_start_time: candidate.start_time,
            fixed_end_time: candidate.end_time,
          })),
      });
    }
    if (activeIssue.field !== "Fixed Time") {
      suggestions.push({
        label: "Open requirements editor",
        detail: "Review the row in the full editor if this issue is not a fixed-time clash.",
        apply: () => {
          window.location.hash = "#upload";
        },
      });
    }
    return suggestions;
  }, [activeIssue, conflictSessions, timeslots]);

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
<<<<<<< Updated upstream
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
=======
          <div className="status-board">
            <section className="status-card summary-card">
              <div className="status-card-title">Status</div>
              <div className={`status-card-badge ${hasErrors ? "bad" : "good"}`}>
                {hasErrors ? "🔴" : "🟢"}
                <span>{statusLabel}</span>
              </div>
              <p>
                {hasErrors
                  ? "Fix all hard conflicts before generating the timetable."
                  : "No hard validation conflicts detected. You may proceed to generate."}
              </p>
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
                            <button className="button secondary slim" type="button" onClick={() => void openQuickEdit(item)}>
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
              <div className="status-card-title">Generate</div>
              <p>Run the timetable solver once all hard validation checks are clear.</p>
              <button className="button large" disabled={hasErrors || isGenerating} onClick={handleGenerate}>
                {isGenerating ? <RefreshCw className="spin" size={18} /> : <Play size={18} />}
                {isGenerating ? "Running solver" : "Generate Timetable"}
              </button>
            </section>
          </div>

          {generationError && <div className="notice bad">{generationError}</div>}
          {generationResult && (
            <>
              <section className="metric-grid compact">
                <div className="metric-card">
                  <span>Run ID</span>
                  <strong>{generationResult.schedule_run_id}</strong>
                </div>
                <div className="metric-card">
                  <span>Solver</span>
                  <strong>{generationResult.solver_status}</strong>
                </div>
                <div className="metric-card">
                  <span>Hard conflicts</span>
                  <strong>{generationResult.hard_violation_count}</strong>
                </div>
                <div className="metric-card">
                  <span>Soft score</span>
                  <strong>{generationResult.soft_score}</strong>
                </div>
              </section>
              <div className="notice good">{generationResult.message}</div>
            </>
          )}

          {activeIssue && (
            <div className="modal-backdrop" role="dialog" aria-modal="true">
              <div className="modal-content quick-edit-panel">
                <div className="modal-header">
                  <div>
                    <h2>Quick Edit</h2>
                    <p>Review the conflicting rows and apply a fix without reuploading.</p>
                  </div>
                  <button className="button secondary slim" type="button" onClick={closeQuickEdit}>
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

                  <div className="suggestion-list">
                    <strong>Suggested fixes</strong>
                    {quickSuggestions.map((suggestion) => (
                      <button className="suggestion-button" key={suggestion.label} type="button" onClick={suggestion.apply}>
                        <span>{suggestion.label}</span>
                        <small>{suggestion.detail}</small>
                      </button>
                    ))}
                  </div>

                  {conflictSessions?.anchor && conflictSessions?.target ? (
                    <div className="quick-edit-grid">
                      <div>
                        <h3>Other conflicting row</h3>
                        <div className="detail-row">
                          <strong>Requirement</strong>
                          <span>{conflictSessions.anchor.requirement_id ?? `Row ${conflictSessions.anchor.source_row_no ?? conflictSessions.anchor.id}`}</span>
                        </div>
                        <div className="detail-row">
                          <strong>Student Group</strong>
                          <span>{conflictSessions.anchor.student_group_code ?? "—"}</span>
                        </div>
                        <div className="detail-row">
                          <strong>Fixed Day</strong>
                          <span>{conflictSessions.anchor.fixed_day ?? "None"}</span>
                        </div>
                        <div className="detail-row">
                          <strong>Fixed Start</strong>
                          <span>{conflictSessions.anchor.fixed_start_time ?? "None"}</span>
                        </div>
                        <div className="detail-row">
                          <strong>Fixed End</strong>
                          <span>{conflictSessions.anchor.fixed_end_time ?? "None"}</span>
                        </div>
                        <div className="detail-row">
                          <strong>Scheduling Type</strong>
                          <span>{conflictSessions.anchor.scheduling_type ?? "Flexible"}</span>
                        </div>
                      </div>

                      <div>
                        <h3>Editable row</h3>
                        <div className="detail-row">
                          <strong>Requirement</strong>
                          <span>{conflictSessions.target.requirement_id ?? `Row ${conflictSessions.target.source_row_no ?? conflictSessions.target.id}`}</span>
                        </div>
                        <div className="detail-row">
                          <label>
                            <strong>Student Group</strong>
                            <input
                              value={editValues.student_group_code}
                              onChange={(event) => setEditValues((prev) => ({ ...prev, student_group_code: event.target.value }))}
                            />
                          </label>
                        </div>
                        <div className="detail-row">
                          <label>
                            <strong>Fixed Day</strong>
                            <select
                              value={editValues.fixed_day}
                              onChange={(event) => setEditValues((prev) => ({ ...prev, fixed_day: event.target.value }))}
                            >
                              <option value="">Select day</option>
                              {dayOptions.map((day) => (
                                <option key={day} value={day}>
                                  {day}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="detail-row">
                          <label>
                            <strong>Fixed Start Time</strong>
                            <select
                              value={editValues.fixed_start_time}
                              onChange={(event) => setEditValues((prev) => ({ ...prev, fixed_start_time: event.target.value }))}
                            >
                              <option value="">Select time</option>
                              {startTimeOptions.map((time) => (
                                <option key={time} value={time}>
                                  {time}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="detail-row">
                          <label>
                            <strong>Fixed End Time</strong>
                            <select
                              value={editValues.fixed_end_time}
                              onChange={(event) => setEditValues((prev) => ({ ...prev, fixed_end_time: event.target.value }))}
                            >
                              <option value="">Select time</option>
                              {endTimeOptions.map((time) => (
                                <option key={time} value={time}>
                                  {time}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="detail-row">
                          <label>
                            <strong>Scheduling Type</strong>
                            <select
                              value={editValues.scheduling_type}
                              onChange={(event) => setEditValues((prev) => ({ ...prev, scheduling_type: event.target.value }))}
                            >
                              <option value="Flexible">Flexible</option>
                              <option value="Fixed">Fixed</option>
                            </select>
                          </label>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="detail-row">
                      <span>Conflict rows are unavailable for editing.</span>
                    </div>
                  )}

                  {saveError && <div className="notice bad">{saveError}</div>}
                </div>

                <div className="modal-footer">
                  <button className="button secondary" type="button" onClick={() => (window.location.hash = "#upload")}>Open Upload</button>
                  <button className="button secondary" type="button" onClick={closeQuickEdit}>
                    Close
                  </button>
                  <button className="button" type="button" onClick={saveQuickEdit} disabled={isSaving || !conflictSessions?.target}>
                    {isSaving ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </div>
            </div>
          )}
>>>>>>> Stashed changes
        </>
      )}
    </div>
  );
}
