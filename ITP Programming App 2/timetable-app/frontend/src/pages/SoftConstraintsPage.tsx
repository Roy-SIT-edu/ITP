/*
 * Timetable generation page.
 * Runs CP-SAT generation using soft constraint priorities configured in Settings.
 */

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  generateSchedule,
  getAcademicYears,
  getDefaultPlanningPeriod,
  getSoftConstraintPriorities,
  updateSoftConstraintPriorities,
} from "../api/client";
import GenerationPeriodSelector from "../components/GenerationPeriodSelector";
import { GenerationActionPanel } from "../components/SoftConstraintWorkflow";
import InlineActivity from "../components/InlineActivity";
import { notifyWorkflowProgressChange } from "../components/WorkflowProgress";
import { estimateGenerationSeconds, getGenerationMode, rememberGenerationSeconds } from "../generationMode";
import { useSessionState } from "../sessionState";
import { rankSoftPriorities } from "../softPriorities";
import type { AcademicYearSummary, ScheduleGenerateResult, SoftConstraintPriority } from "../types";

const COMPLETION_ANIMATION_MS = 650;

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
  const [generationCompleting, setGenerationCompleting] = useState(false);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [generationElapsedSeconds, setGenerationElapsedSeconds] = useState(0);
  const [generationEstimatedSeconds, setGenerationEstimatedSeconds] = useState(0);
  const [academicYears, setAcademicYears] = useState<AcademicYearSummary[]>([]);
  const [academicYear, setAcademicYear] = useState("");
  const [trimester, setTrimester] = useState<number | "">("");
  const [dirty, setDirty] = useSessionState("soft.dirty", false);
  const generationMode = getGenerationMode();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [yearRows, defaultPeriod] = await Promise.all([getAcademicYears(), getDefaultPlanningPeriod()]);
      setAcademicYears(yearRows);
      setAcademicYear((current) =>
        current && yearRows.some((item) => item.academic_year === current) ? current : defaultPeriod.academic_year,
      );
      setTrimester((current) => current || defaultPeriod.trimester);
      if (!dirty) {
        const nextPriorities = await getSoftConstraintPriorities();
        setPriorities(rankSoftPriorities(nextPriorities));
        setDirty(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load soft constraints");
    } finally {
      setLoading(false);
    }
  }, [dirty, setDirty, setError, setPriorities]);

  useEffect(() => {
    if (academicYears.length === 0 || (!dirty && priorities.length === 0)) {
      void load();
    }
  }, [academicYears.length, dirty, load, priorities.length]);

  useEffect(() => {
    if (generationStartedAt === null) return;
    const updateElapsed = () => setGenerationElapsedSeconds((Date.now() - generationStartedAt) / 1000);
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [generationStartedAt]);

  const isBusy = loading || saving || generating;
  const canGenerate =
    !loading &&
    Boolean(academicYear) &&
    Boolean(trimester) &&
    academicYears.some((item) => item.academic_year === academicYear);

  const savePriorities = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await updateSoftConstraintPriorities(rankSoftPriorities(priorities, true));
      setPriorities(rankSoftPriorities(saved));
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
    setGenerationCompleting(false);
    setError(null);
    setSuccess(null);

    try {
      if (dirty) {
        const saved = await savePriorities();
        if (!saved) return;
      }
      const startedAt = Date.now();
      setGenerationElapsedSeconds(0);
      setGenerationEstimatedSeconds(estimateGenerationSeconds(generationMode));
      setGenerationStartedAt(startedAt);
      if (!academicYear || !trimester) {
        setError("Select an academic year and trimester before generating.");
        return;
      }
      const result = await generateSchedule(generationMode, {
        academic_year: academicYear,
        trimester,
      });
      const completedSeconds = result.generation_seconds ?? (Date.now() - startedAt) / 1000;
      setGenerationStartedAt(null);
      setGenerationElapsedSeconds(completedSeconds);
      rememberGenerationSeconds(generationMode, completedSeconds);
      setGenerationCompleting(true);
      await new Promise((resolve) => window.setTimeout(resolve, COMPLETION_ANIMATION_MS));
      setGenerationResult(result);
      setSuccess(result.message);
      notifyWorkflowProgressChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerationStartedAt(null);
      setGenerationCompleting(false);
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
      <GenerationPeriodSelector
        academicYear={academicYear}
        academicYears={academicYears}
        disabled={isBusy}
        trimester={trimester}
        onAcademicYearChange={setAcademicYear}
        onTrimesterChange={setTrimester}
      />
      <GenerationActionPanel
        canGenerate={canGenerate}
        dirty={dirty}
        completing={generationCompleting}
        generating={generating}
        generationResult={generationResult}
        generationMode={generationMode}
        elapsedSeconds={generationElapsedSeconds}
        estimatedSeconds={generationEstimatedSeconds}
        saving={saving}
        onGenerate={handleGenerate}
      />
    </div>
  );
}
