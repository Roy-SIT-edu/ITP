/*
 * Validation page.
 * Runs hard saved-requirement checks before soft ranking and generation.
 */

import { CheckCircle2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, getSession, getTimeSlots, getValidation, updateSession } from "../api/client";
import RequirementsEditor from "../components/RequirementsEditor";
import InlineActivity from "../components/InlineActivity";
import ValidationQuickEditModal from "../components/validation/ValidationQuickEditModal";
import ValidationStatusBoard from "../components/validation/ValidationStatusBoard";
import type {
  ConflictSessions,
  QuickEditValues,
  QuickSuggestion,
  ValidationIssueRow,
} from "../components/validation/types";
import { labelForStatus } from "../components/validation/validationDisplay";
import { notifyWorkflowProgressChange } from "../components/WorkflowProgress";
import { useSessionState } from "../sessionState";
import type { SessionRow, TimeSlot, ValidationIssue, ValidationResult } from "../types";

export default function ValidationPage() {
  const [validation, setValidation] = useSessionState<ValidationResult | null>("validation.result", null);
  const [error, setError] = useSessionState<string | null>("validation.error", null);
  const [hasValidated, setHasValidated] = useSessionState("validation.hasValidated", false);
  const [isValidating, setIsValidating] = useState(false);
  const [editorRefreshSignal, setEditorRefreshSignal] = useSessionState("validation.editorRefreshSignal", 0);
  const [activeIssue, setActiveIssue] = useSessionState<ValidationIssue | null>("validation.activeIssue", null);
  const [conflictSessions, setConflictSessions] = useSessionState<ConflictSessions>(
    "validation.conflictSessions",
    null,
  );
  const [timeslots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [editValues, setEditValues] = useSessionState<QuickEditValues>("validation.editValues", {
    fixed_day: "",
    fixed_start_time: "",
    fixed_end_time: "",
    scheduling_type: "Flexible",
    student_group_code: "",
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
    getTimeSlots()
      .then(setTimeSlots)
      .catch(() => setTimeSlots([]));
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
      new Set(timeslots.filter((slot) => slot.day === editValues.fixed_day).map((slot) => slot.start_time)),
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

  const closeQuickEdit = useCallback(() => {
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
    });
  }, [setActiveIssue, setConflictSessions, setEditValues, setSaveError]);

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
    } catch {
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

  const quickSuggestions = useMemo<QuickSuggestion[]>(() => {
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
        (slot.day !== anchor?.fixed_day ||
          slot.start_time !== anchor?.fixed_start_time ||
          slot.end_time !== anchor?.fixed_end_time),
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
  }, [activeIssue, closeQuickEdit, conflictSessions, setEditValues, timeslots]);

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
      {isValidating && (
        <InlineActivity
          kind="validate"
          title="Checking hard constraints"
          steps={["Matching records", "Checking fixed-time clashes", "Reviewing staff and group conflicts"]}
        />
      )}
      <ValidationStatusBoard
        hasValidated={hasValidated}
        hasErrors={hasErrors}
        validation={validation}
        statusLabel={statusLabel}
        issueRows={issueRows}
        onQuickEdit={(item) => void openQuickEdit(item)}
      />

      {hasValidated && (
        <RequirementsEditor
          refreshSignal={editorRefreshSignal}
          onChanged={() => {
            void refreshValidationAfterEdit();
          }}
        />
      )}

      {hasValidated && activeIssue && (
        <ValidationQuickEditModal
          activeIssue={activeIssue}
          conflictSessions={conflictSessions}
          editValues={editValues}
          saveError={saveError}
          isSaving={isSaving}
          dayOptions={dayOptions}
          startTimeOptions={startTimeOptions}
          endTimeOptions={endTimeOptions}
          quickSuggestions={quickSuggestions}
          setEditValues={setEditValues}
          onClose={closeQuickEdit}
          onSave={saveQuickEdit}
        />
      )}
    </div>
  );
}
