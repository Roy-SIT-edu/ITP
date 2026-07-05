/*
 * Timetable generation page.
 * Runs CP-SAT generation using soft constraint priorities configured in Priority Rankings.
 */

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  generateSchedule,
  getSoftConstraintPriorities,
  updateSoftConstraintPriorities,
} from "../api/client";
import { GenerationActionPanel } from "../components/SoftConstraintWorkflow";
import InlineActivity from "../components/InlineActivity";
import { notifyWorkflowProgressChange } from "../components/WorkflowProgress";
import { useSessionState } from "../sessionState";
import type { ScheduleGenerateResult, SoftConstraintPriority } from "../types";

export default function SoftConstraintsPage() {
  const [priorities, setPriorities] = useSessionState<SoftConstraintPriority[]>("soft.priorities", []);
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
      if (!dirty) {
        const nextPriorities = await getSoftConstraintPriorities();
        setPriorities(nextPriorities);
        setDirty(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load soft constraints");
    } finally {
      setLoading(false);
    }
  }, [dirty, setDirty, setError, setPriorities]);

  useEffect(() => {
    if (!dirty && priorities.length === 0) {
      void load();
    }
  }, [dirty, load, priorities.length]);

  const isBusy = loading || saving || generating;
  const canGenerate = !loading;

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

      <GenerationActionPanel
        canGenerate={canGenerate}
        dirty={dirty}
        generating={generating}
        generationResult={generationResult}
        saving={saving}
        onGenerate={handleGenerate}
      />
    </div>
  );
}
