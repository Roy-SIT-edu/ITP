/*
 * Soft constraint ranking and timetable generation page.
 * Lets users tune solver priorities before CP-SAT generation runs.
 */

import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  generateSchedule,
  getSessions,
  getSoftConstraintPriorities,
  getValidation,
  updateSoftConstraintPriorities,
} from "../api/client";
import {
  GenerationReadinessPanel,
  PriorityRanking,
  SoftPreferenceTable,
} from "../components/SoftConstraintWorkflow";
import { notifyWorkflowProgressChange } from "../components/WorkflowProgress";
import { useSessionState } from "../sessionState";
import type { ScheduleGenerateResult, SessionRow, SoftConstraintPriority, ValidationResult } from "../types";
import type { SoftPreferenceHint } from "../components/SoftConstraintWorkflow";

function previewWeight(index: number, total: number) {
  return Math.max(1, total - index) * 5;
}

function softConstraintHints(session: SessionRow): SoftPreferenceHint[] {
  const hints: SoftPreferenceHint[] = [];
  if (session.preferred_days) hints.push({ label: "Preferred", value: session.preferred_days, tone: "preferred" });
  if (session.avoid_days) hints.push({ label: "Avoid", value: session.avoid_days, tone: "avoid" });
  if ((session.delivery_mode || "").toLowerCase().includes("online")) {
    hints.push({ label: "Delivery", value: "Online placement preference", tone: "online" });
  }
  if (session.remarks) hints.push({ label: "Remarks", value: session.remarks, tone: "remarks" });
  return hints;
}

export default function SoftConstraintsPage() {
  const [priorities, setPriorities] = useSessionState<SoftConstraintPriority[]>("soft.priorities", []);
  const [validation, setValidation] = useSessionState<ValidationResult | null>("soft.validation", null);
  const [sessions, setSessions] = useSessionState<SessionRow[]>("soft.sessions", []);
  const [generationResult, setGenerationResult] = useSessionState<ScheduleGenerateResult | null>("soft.generationResult", null);
  const [error, setError] = useSessionState<string | null>("soft.error", null);
  const [success, setSuccess] = useSessionState<string | null>("soft.success", null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [dirty, setDirty] = useSessionState("soft.dirty", false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextPriorities, nextValidation, nextSessions] = await Promise.all([
        getSoftConstraintPriorities(),
        getValidation(),
        getSessions(),
      ]);
      setPriorities(nextPriorities);
      setValidation(nextValidation);
      setSessions(nextSessions);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load soft constraints");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (priorities.length === 0 && sessions.length === 0 && !validation && !generationResult) {
      void load();
    }
  }, []);

  const rankedPriorities = useMemo(
    () =>
      priorities.map((item, index) => ({
        ...item,
        rank: index + 1,
        weight: dirty ? previewWeight(index, priorities.length) : item.weight,
      })),
    [dirty, priorities],
  );

  const softRows = useMemo(
    () =>
      sessions
        .map((session) => ({ session, hints: softConstraintHints(session) }))
        .filter((item) => item.hints.length > 0),
    [sessions],
  );

  const warnings = validation?.warnings ?? [];
  const hardErrorCount = validation?.error_count ?? 0;
  const hasHardErrors = hardErrorCount > 0;
  const isBusy = loading || saving || generating;
  const canGenerate = !!validation && !hasHardErrors && priorities.length > 0 && !loading;
  const readinessText = !validation
    ? "Run validation before generating."
    : hasHardErrors
      ? `${hardErrorCount} hard validation error${hardErrorCount === 1 ? "" : "s"} must be fixed first.`
      : "Hard constraints are clear.";

  const movePriority = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= priorities.length) return;
    setPriorities((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setDirty(true);
    setSuccess(null);
  };

  const savePriorities = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await updateSoftConstraintPriorities(priorities.map((item) => item.constraint_code));
      setPriorities(saved);
      setDirty(false);
      setSuccess("Soft constraint ranking saved.");
      return saved;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save soft constraint ranking");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setGenerating(true);
    setGenerationResult(null);
    setError(null);
    setSuccess(null);

    try {
      if (dirty) {
        const saved = await savePriorities();
        if (!saved) return;
      }
      const result = await generateSchedule();
      setGenerationResult(result);
      setValidation(await getValidation());
      setSuccess(result.message);
      notifyWorkflowProgressChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Priorities & Generate</h1>
          <p>Rank soft constraints and run timetable generation</p>
        </div>
        <div className="toolbar-row">
          <button className="button secondary" onClick={() => void load()} disabled={isBusy}>
            <RefreshCw className={loading ? "spin" : ""} size={17} />
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="notice bad">{error}</div>}
      {success && <div className="notice good">{success}</div>}

      <GenerationReadinessPanel
        canGenerate={canGenerate}
        dirty={dirty}
        generating={generating}
        generationResult={generationResult}
        hasHardErrors={hasHardErrors}
        priorityCount={rankedPriorities.length}
        readinessText={readinessText}
        saving={saving}
        softRowCount={softRows.length}
        validationLoaded={!!validation}
        warningCount={warnings.length}
        onGenerate={handleGenerate}
      />

      <div className="soft-workspace">
        <PriorityRanking
          dirty={dirty}
          generating={generating}
          priorities={rankedPriorities}
          saving={saving}
          onMove={movePriority}
          onSave={() => void savePriorities()}
        />

        <SoftPreferenceTable rows={softRows} warningCount={warnings.length} />
      </div>
    </div>
  );
}
