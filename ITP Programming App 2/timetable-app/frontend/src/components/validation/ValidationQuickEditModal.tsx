import { type Dispatch, type SetStateAction } from "react";
import type { ValidationIssue } from "../../types";
import type { ConflictSessions, QuickEditValues, QuickSuggestion } from "./types";
import { formatIssueType } from "./validationDisplay";

type Props = {
  activeIssue: ValidationIssue;
  conflictSessions: ConflictSessions;
  editValues: QuickEditValues;
  saveError: string | null;
  isSaving: boolean;
  dayOptions: string[];
  startTimeOptions: string[];
  endTimeOptions: string[];
  quickSuggestions: QuickSuggestion[];
  setEditValues: Dispatch<SetStateAction<QuickEditValues>>;
  onClose: () => void;
  onSave: () => void;
};

export default function ValidationQuickEditModal({
  activeIssue,
  conflictSessions,
  editValues,
  saveError,
  isSaving,
  dayOptions,
  startTimeOptions,
  endTimeOptions,
  quickSuggestions,
  setEditValues,
  onClose,
  onSave,
}: Props) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-content quick-edit-panel">
        <div className="modal-header">
          <div>
            <h2>Quick Edit</h2>
            <p>Review the conflicting rows and apply a fix without reuploading.</p>
          </div>
          <button className="button secondary slim" type="button" onClick={onClose}>
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
                      onChange={(event) =>
                        setEditValues((prev) => ({ ...prev, student_group_code: event.target.value }))
                      }
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
                    <select value="Flexible" disabled>
                      <option value="Flexible">Flexible</option>
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
          <button className="button secondary" type="button" onClick={onClose}>
            Close
          </button>
          <button className="button" type="button" onClick={onSave} disabled={isSaving || !conflictSessions?.target}>
            {isSaving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
