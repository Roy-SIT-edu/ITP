/*
 * Timetable generation page.
 * Runs CP-SAT generation using soft constraint priorities configured in Settings.
 */

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  generateSchedule,
  getSessions,
  getSoftConstraintPriorities,
  updateSoftConstraintPriorities,
} from "../api/client";
import { GenerationReadinessPanel, SoftPreferenceTable } from "../components/SoftConstraintWorkflow";
import InlineActivity from "../components/InlineActivity";
import { notifyWorkflowProgressChange } from "../components/WorkflowProgress";
import { useSessionState } from "../sessionState";
import type { ScheduleGenerateResult, SessionRow, SoftConstraintPriority } from "../types";
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
  const [sessions, setSessions] = useSessionState<SessionRow[]>("soft.sessions", []);
  const [generationResult, setGenerationResult] = useSessionState<ScheduleGenerateResult | null>(
    "soft.generationResult",
    null,
  );
  const [error, setError] = useSessionState<string | null>("soft.error", null);
  const [success, setSuccess] = useSessionState<string | null>("soft.success", null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [dirty, setDirty] = useSessionState("soft.dirty", false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (dirty) {
        setSessions(await getSessions());
      } else {
        const [nextPriorities, nextSessions] = await Promise.all([getSoftConstraintPriorities(), getSessions()]);
        setPriorities(nextPriorities);
        setSessions(nextSessions);
        setDirty(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load soft constraints");
    } finally {
      setLoading(false);
    }
  }, [dirty, setDirty, setError, setPriorities, setSessions]);

  useEffect(() => {
    const shouldLoadInitial = sessions.length === 0 || (!dirty && priorities.length === 0);
    if (shouldLoadInitial) {
      void load();
    }
  }, [dirty, load, priorities.length, sessions.length]);

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

  const warnings: { field: string; message: string }[] = [];
  const isBusy = loading || saving || generating;
  const canGenerate = !loading;
  const readinessText = "Ready to generate.";

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
          <h1>Generate Timetable</h1>
          <p>Run timetable generation with the configured soft constraint ranking</p>
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
      {loading && (
        <InlineActivity
          kind="validate"
          title="Loading generation inputs"
          steps={["Loading priorities", "Reading validation status", "Preparing session hints"]}
        />
      )}
      {saving && (
        <InlineActivity
          kind="generate"
          title="Saving soft priorities"
          steps={["Ordering preferences", "Updating weights", "Preparing solver"]}
        />
      )}
      {generating && (
        <InlineActivity
          kind="generate"
          title="Generating timetable"
          steps={["Applying hard constraints", "Scoring soft preferences", "Selecting timetable placements"]}
        />
      )}

      <GenerationReadinessPanel
        canGenerate={canGenerate}
        dirty={dirty}
        generating={generating}
        generationResult={generationResult}
        priorityCount={rankedPriorities.length}
        readinessText={readinessText}
        saving={saving}
        softRowCount={softRows.length}
        warningCount={warnings.length}
        onGenerate={handleGenerate}
      />

      <div className="soft-workspace">
        <SoftPreferenceTable rows={softRows} warningCount={warnings.length} />
      </div>
    </div>
  );
}
