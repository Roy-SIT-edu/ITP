/*
 * Settings page.
 * Keeps solver preference configuration outside the generation workflow page.
 */

import { Gauge, Moon, RefreshCw, Repeat2, Sun } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSoftConstraintPriorities, updateSoftConstraintPriorities } from "../api/client";
import InlineActivity from "../components/InlineActivity";
import { PriorityRanking } from "../components/SoftConstraintWorkflow";
import { generationModeLabel, useGenerationMode } from "../generationMode";
import { useSessionState } from "../sessionState";
import { moveSoftPriority, rankSoftPriorities, setSoftPriorityActive } from "../softPriorities";
import { useThemeMode } from "../theme";
import type { SoftConstraintPriority } from "../types";

export default function SettingsPage() {
  const [priorities, setPriorities] = useSessionState<SoftConstraintPriority[]>("soft.priorities", []);
  const [dirty, setDirty] = useSessionState("soft.dirty", false);
  const [error, setError] = useSessionState<string | null>("settings.error", null);
  const [success, setSuccess] = useSessionState<string | null>("settings.success", null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { themeMode, setThemeMode } = useThemeMode();
  const { generationMode, setGenerationMode } = useGenerationMode();
  const nightMode = themeMode === "night";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextPriorities = await getSoftConstraintPriorities();
      setPriorities(rankSoftPriorities(nextPriorities));
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load settings");
    } finally {
      setLoading(false);
    }
  }, [setDirty, setError, setPriorities]);

  useEffect(() => {
    if (priorities.length === 0) {
      void load();
    }
  }, [load, priorities.length]);

  const rankedPriorities = useMemo(() => rankSoftPriorities(priorities, dirty), [dirty, priorities]);

  const movePriority = (index: number, direction: -1 | 1) => {
    setPriorities((current) => moveSoftPriority(current, index, direction));
    setDirty(true);
    setSuccess(null);
  };

  const togglePriority = (constraintCode: string, isActive: boolean) => {
    setPriorities((current) => setSoftPriorityActive(current, constraintCode, isActive));
    setDirty(true);
    setSuccess(null);
  };

  const savePriorities = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await updateSoftConstraintPriorities(rankSoftPriorities(priorities, true));
      setPriorities(rankSoftPriorities(saved));
      setDirty(false);
      setSuccess("Soft constraint ranking saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save soft constraint ranking");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Configure solver behaviour, appearance, and soft constraint priorities</p>
        </div>
        <div className="toolbar-row">
          <button className="button secondary" onClick={() => void load()} disabled={loading || saving}>
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
          title="Loading settings"
          steps={["Reading soft constraints", "Preparing ranking controls"]}
        />
      )}
      {saving && (
        <InlineActivity
          kind="generate"
          title="Saving soft priorities"
          steps={["Ordering preferences", "Updating weights", "Preparing solver"]}
        />
      )}

      <section className="status-card settings-card appearance-card">
        <div className="section-heading">
          <div>
            <div className="status-card-title">Appearance</div>
            <p>Choose the interface brightness for this device</p>
          </div>
          <label className="theme-toggle">
            <input
              checked={nightMode}
              type="checkbox"
              onChange={(event) => setThemeMode(event.target.checked ? "night" : "light")}
            />
            <span className="theme-toggle-track" aria-hidden="true">
              <span className="theme-toggle-thumb">{nightMode ? <Moon size={15} /> : <Sun size={15} />}</span>
            </span>
            <span className="theme-toggle-label">{nightMode ? "Night mode" : "Day mode"}</span>
          </label>
        </div>
      </section>

      <section className="status-card settings-card generation-mode-card">
        <div className="section-heading">
          <div>
            <div className="status-card-title">Generation Mode</div>
            <p>Choose whether generation prioritises speed or repeatable results</p>
          </div>
          <span className="generation-mode-current">Current: {generationModeLabel(generationMode)}</span>
        </div>

        <div className="generation-mode-options" aria-label="Timetable generation mode" role="group">
          <button
            aria-pressed={generationMode === "standard"}
            className={`generation-mode-option ${generationMode === "standard" ? "selected" : ""}`}
            onClick={() => setGenerationMode("standard")}
            type="button"
          >
            <span className="generation-mode-icon" aria-hidden="true">
              <Gauge size={20} />
            </span>
            <span>
              <strong>Standard</strong>
              <small>Faster parallel search. Results can vary slightly between runs.</small>
            </span>
          </button>
          <button
            aria-pressed={generationMode === "reproducible"}
            className={`generation-mode-option ${generationMode === "reproducible" ? "selected" : ""}`}
            onClick={() => setGenerationMode("reproducible")}
            type="button"
          >
            <span className="generation-mode-icon" aria-hidden="true">
              <Repeat2 size={20} />
            </span>
            <span>
              <strong>Reproducible</strong>
              <small>Fixed single-worker search for more consistent results from the same inputs.</small>
            </span>
          </button>
        </div>
        <p className="generation-mode-note">
          Reproducible mode usually takes 1–3 minutes on a large timetable and now has a five-minute solver budget. The
          Generate Timetable page shows live elapsed and estimated remaining time.
        </p>
      </section>

      <PriorityRanking
        dirty={dirty}
        generating={false}
        priorities={rankedPriorities}
        saving={saving}
        onMove={movePriority}
        onSave={() => void savePriorities()}
        onToggle={togglePriority}
      />
    </div>
  );
}
