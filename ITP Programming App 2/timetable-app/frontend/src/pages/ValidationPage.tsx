/*
 * Validation page.
 * Runs hard saved-requirement checks before soft ranking and generation.
 */

import { CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  getSession,
  getSessions,
  getTimeSlots,
  getValidation,
  updateSession,
} from "../api/client";
import RequirementsEditor from "../components/RequirementsEditor";
import StatusBadge from "../components/StatusBadge";
import { notifyWorkflowProgressChange } from "../components/WorkflowProgress";
import { useSessionState } from "../sessionState";
import type { SessionRow, TimeSlot, ValidationIssue, ValidationResult } from "../types";

const ISSUE_LABELS: Record<string, string> = {
  "Fixed Time": "Fixed session conflict",
};

function formatIssueType(field: string) {
  return ISSUE_LABELS[field] ?? field;
}

function labelForStatus(errorCount: number) {
  return errorCount === 0 ? "Clean: Ready to Generate" : `Attention Required: ${errorCount} Conflict${errorCount === 1 ? "" : "s"} Found`;
}

type ValidationIssueRow = ValidationIssue & {
  level: "Error";
};

export default function ValidationPage() {
  const [validation, setValidation] = useSessionState<ValidationResult | null>("validation.result", null);
  const [error, setError] = useSessionState<string | null>("validation.error", null);
  const [hasValidated, setHasValidated] = useSessionState("validation.hasValidated", false);
  const [isValidating, setIsValidating] = useState(false);
  const [editorRefreshSignal, setEditorRefreshSignal] = useSessionState("validation.editorRefreshSignal", 0);
  const [activeIssue, setActiveIssue] = useSessionState<ValidationIssue | null>("validation.activeIssue", null);
  const [conflictSessions, setConflictSessions] = useSessionState<{ anchor?: SessionRow; target?: SessionRow } | null>(
    "validation.conflictSessions",
    null,
  );
  const [timeslots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [editValues, setEditValues] = useSessionState("validation.editValues", {
    fixed_day: "",
    fixed_start_time: "",
    fixed_end_time: "",
    scheduling_type: "Flexible",
    student_group_code: "",
    delivery_mode: "",
    campus_mode: "",
    venue_type_required: "",
    exact_class_size: "",
    duration_minutes: "",
    priority: "",
    avoid_days: "",
    preferred_days: "",
  });
  const [saveError, setSaveError] = useSessionState<string | null>("validation.saveError", null);
  const [isSaving, setIsSaving] = useState(false);

  const loadValidation = async () => {
    setIsValidating(true);
    setError(null);
    setSaveError(null);
    setActiveIssue(null);
    setConflictSessions(null);

    try {
      setValidation(await getValidation());
      setHasValidated(true);
      notifyWorkflowProgressChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setIsValidating(false);
    }
  };

  useEffect(() => {
    getTimeSlots().then(setTimeSlots).catch(() => setTimeSlots([]));
  }, []);

  const issueRows = useMemo<ValidationIssueRow[]>(() => {
    if (!validation) return [];
    return validation.errors.map((item) => ({ ...item, level: "Error" as const }));
  }, [validation]);

  const hasErrors = hasValidated && !!validation && validation.error_count > 0;
  const statusLabel = !hasValidated
    ? "Click Validate to check the imported requirements."
    : validation
      ? labelForStatus(validation.error_count)
      : "Validation has not run yet.";

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
    setEditValues({
      fixed_day: "",
      fixed_start_time: "",
      fixed_end_time: "",
      scheduling_type: "Flexible",
      student_group_code: "",
      delivery_mode: "",
      campus_mode: "",
      venue_type_required: "",
      exact_class_size: "",
      duration_minutes: "",
      priority: "",
      avoid_days: "",
      preferred_days: "",
    });
  };

  const refreshValidationAfterEdit = async () => {
    if (!hasValidated) return;
    try {
      setValidation(await getValidation());
      notifyWorkflowProgressChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation refresh failed");
    }
  };

  const openQuickEdit = async (item: ValidationIssue) => {
    setError(null);
    setSaveError(null);
    setActiveIssue(item);

    try {
      let target: SessionRow | undefined;
      let anchor: SessionRow | undefined;

      if (item.conflict_session_ids?.length) {
        const sessions = await Promise.all(item.conflict_session_ids.map(getSession));
        target =
          sessions.find(
            (session) => session.requirement_id === item.requirement_id || session.source_row_no === item.row,
          ) ?? sessions[0];
        anchor = sessions.find((session) => session.id !== target?.id);
      } else {
        const allSessions = await getSessions();
        target = allSessions.find(
          (session) => session.requirement_id === item.requirement_id || session.source_row_no === item.row,
        );
      }

      setConflictSessions({ anchor, target });
      
      if (target) {
        setEditValues({
          fixed_day: target.fixed_day ?? "",
          fixed_start_time: target.fixed_start_time ?? "",
          fixed_end_time: target.fixed_end_time ?? "",
          scheduling_type: target.scheduling_type ?? "Flexible",
          student_group_code: target.student_group_code ?? "",
          delivery_mode: target.delivery_mode ?? "",
          campus_mode: target.campus_mode ?? "",
          venue_type_required: target.venue_type_required ?? "",
          exact_class_size: (target.exact_class_size ?? "").toString(),
          duration_minutes: (target.duration_minutes ?? "").toString(),
          priority: target.priority ?? "",
          avoid_days: target.avoid_days ?? "",
          preferred_days: target.preferred_days ?? "",
        });
      }
    } catch (err) {
      setSaveError("Unable to load row(s) for quick edit.");
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
        delivery_mode: editValues.delivery_mode || null,
        campus_mode: editValues.campus_mode || null,
        venue_type_required: editValues.venue_type_required || null,
        exact_class_size: editValues.exact_class_size ? parseInt(editValues.exact_class_size, 10) : null,
        duration_minutes: editValues.duration_minutes ? parseInt(editValues.duration_minutes, 10) : null,
        priority: editValues.priority || null,
        avoid_days: editValues.avoid_days || null,
        preferred_days: editValues.preferred_days || null,
      };

      await updateSession(conflictSessions.target.id, payload);
      const refreshedValidation = await getValidation();
      setValidation(refreshedValidation);
      setHasValidated(true);
      setEditorRefreshSignal((current) => current + 1);
      notifyWorkflowProgressChange();

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
        label: "Review in requirements table",
        detail: "Close this panel and use the full editor below for non-fixed-time issues.",
        apply: closeQuickEdit,
      });
    }
    return suggestions;
  }, [activeIssue, conflictSessions, timeslots]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Validate Data</h1>
          <p>Hard constraint and input quality checks</p>
        </div>
        <div className="toolbar-row">
          <button className="button" onClick={loadValidation} disabled={isValidating}>
            <CheckCircle2 size={17} />
            {isValidating ? "Validating" : "Validate"}
          </button>
        </div>
      </div>
      {error && <div className="notice bad">{error}</div>}
      <div className="status-board">
        <section className="status-card summary-card">
          <div className="status-card-title">Status</div>
          <div className="status-row">
            <StatusBadge
              label={!hasValidated ? "Not validated" : hasErrors ? "Blocked" : "Ready"}
              tone={!hasValidated ? "neutral" : hasErrors ? "bad" : "good"}
            />
            <span>{statusLabel}</span>
            {hasValidated && validation && (
              <span>{validation.error_count} hard errors</span>
            )}
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
          <div className="status-card-title">Next step</div>
          <p>After hard validation passes, set priorities and generate the timetable.</p>
          <a className={`button large ${hasValidated && validation?.error_count === 0 ? "" : "disabled-link"}`} href="#soft-constraints">
            Priorities & Generate
          </a>
        </section>
      </div>

      {hasValidated && (
        <RequirementsEditor
          refreshSignal={editorRefreshSignal}
          onChanged={() => {
            void refreshValidationAfterEdit();
          }}
        />
      )}

      {hasValidated && activeIssue && (
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

              {conflictSessions?.target ? (
                <div className="quick-edit-grid" style={{ gridTemplateColumns: conflictSessions.anchor ? "repeat(2, minmax(0, 1fr))" : "1fr" }}>
                  {conflictSessions.anchor && (
                  <div>
                    <h3>Other conflicting row</h3>
                    <div className="detail-row">
                      <strong>Requirement</strong>
                      <span>
                        {conflictSessions.anchor.requirement_id ??
                          `Row ${conflictSessions.anchor.source_row_no ?? conflictSessions.anchor.id}`}
                      </span>
                    </div>
                    <div className="detail-row">
                      <strong>Student Group</strong>
                      <span>{conflictSessions.anchor.student_group_code ?? "Not set"}</span>
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
                  )}

                  <div>
                    <h3>Editable row</h3>
                    <div className="detail-row">
                      <strong>Requirement</strong>
                      <span>
                        {conflictSessions.target.requirement_id ??
                          `Row ${conflictSessions.target.source_row_no ?? conflictSessions.target.id}`}
                      </span>
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
                    <div className="detail-row">
                      <label>
                        <strong>Delivery Mode</strong>
                        <select
                          value={editValues.delivery_mode}
                          onChange={(event) => setEditValues((prev) => ({ ...prev, delivery_mode: event.target.value }))}
                        >
                          <option value="">Select Delivery Mode</option>
                          <option value="Face-to-face">Face-to-face</option>
                          <option value="Online">Online</option>
                          <option value="Hybrid">Hybrid</option>
                          <option value="Asynchronous">Asynchronous</option>
                        </select>
                      </label>
                    </div>
                    <div className="detail-row">
                      <label>
                        <strong>Campus Mode</strong>
                        <select
                          value={editValues.campus_mode}
                          onChange={(event) => setEditValues((prev) => ({ ...prev, campus_mode: event.target.value }))}
                        >
                          <option value="">Select Campus Mode</option>
                          <option value="Physical">Physical</option>
                          <option value="Virtual">Virtual</option>
                          <option value="Remote">Remote</option>
                          <option value="Online">Online</option>
                          <option value="On Campus">On Campus</option>
                          <option value="Face to face">Face to face</option>
                        </select>
                      </label>
                    </div>
                    <div className="detail-row">
                      <label>
                        <strong>Venue Type Required</strong>
                        <input
                          value={editValues.venue_type_required}
                          onChange={(event) => setEditValues((prev) => ({ ...prev, venue_type_required: event.target.value }))}
                        />
                      </label>
                    </div>
                    <div className="detail-row">
                      <label>
                        <strong>Exact Class Size</strong>
                        <input
                          type="number"
                          value={editValues.exact_class_size}
                          onChange={(event) => setEditValues((prev) => ({ ...prev, exact_class_size: event.target.value }))}
                        />
                      </label>
                    </div>
                    <div className="detail-row">
                      <label>
                        <strong>Duration (mins)</strong>
                        <input
                          type="number"
                          value={editValues.duration_minutes}
                          onChange={(event) => setEditValues((prev) => ({ ...prev, duration_minutes: event.target.value }))}
                        />
                      </label>
                    </div>
                    <div className="detail-row">
                      <label>
                        <strong>Priority</strong>
                        <select
                          value={editValues.priority}
                          onChange={(event) => setEditValues((prev) => ({ ...prev, priority: event.target.value }))}
                        >
                          <option value="">Select Priority</option>
                          <option value="Hard">Hard</option>
                          <option value="Soft">Soft</option>
                        </select>
                      </label>
                    </div>
                    <div className="detail-row">
                      <label>
                        <strong>Avoid Days</strong>
                        <input
                          value={editValues.avoid_days}
                          onChange={(event) => setEditValues((prev) => ({ ...prev, avoid_days: event.target.value }))}
                        />
                      </label>
                    </div>
                    <div className="detail-row">
                      <label>
                        <strong>Preferred Days</strong>
                        <input
                          value={editValues.preferred_days}
                          onChange={(event) => setEditValues((prev) => ({ ...prev, preferred_days: event.target.value }))}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="detail-row">
                  <span>Row unavailable for editing.</span>
                </div>
              )}

              {saveError && <div className="notice bad">{saveError}</div>}
            </div>

            <div className="modal-footer">
              <button className="button secondary" type="button" onClick={closeQuickEdit}>
                Close
              </button>
              <button className="button" type="button" onClick={saveQuickEdit} disabled={isSaving || !conflictSessions?.target}>
                {isSaving ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
