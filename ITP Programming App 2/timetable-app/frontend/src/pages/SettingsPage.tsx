/*
 * Settings page.
 * Keeps solver preference configuration outside the generation workflow page.
 */

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSoftConstraintPriorities, updateSoftConstraintPriorities } from "../api/client";
import InlineActivity from "../components/InlineActivity";
import { PriorityRanking } from "../components/SoftConstraintWorkflow";
import { useSessionState } from "../sessionState";
import type { SoftConstraintPriority } from "../types";

function previewWeight(index: number, total: number) {
  return Math.max(1, total - index) * 5;
}

export default function SettingsPage() {
  const [priorities, setPriorities] = useSessionState<SoftConstraintPriority[]>("soft.priorities", []);
  const [dirty, setDirty] = useSessionState("soft.dirty", false);
  const [error, setError] = useSessionState<string | null>("settings.error", null);
  const [success, setSuccess] = useSessionState<string | null>("settings.success", null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextPriorities = await getSoftConstraintPriorities();
      setPriorities(nextPriorities);
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

  const rankedPriorities = useMemo(
    () =>
      priorities.map((item, index) => ({
        ...item,
        rank: index + 1,
        weight: dirty ? previewWeight(index, priorities.length) : item.weight,
      })),
    [dirty, priorities],
  );

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
          <p>Configure soft constraint priority ranking for timetable generation</p>
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

      <PriorityRanking
        dirty={dirty}
        generating={false}
        priorities={rankedPriorities}
        saving={saving}
        onMove={movePriority}
        onSave={() => void savePriorities()}
      />
    </div>
  );
}
