/*
 * Priority rankings page.
 * Keeps algorithmic soft-constraint ordering in the workflow before generation.
 */

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSoftConstraintPriorities, updateSoftConstraintPriorities } from "../api/client";
import InlineActivity from "../components/InlineActivity";
import { PriorityRanking } from "../components/SoftConstraintWorkflow";
import { useSessionState } from "../sessionState";
import type { SoftConstraintPriority } from "../types";

type PriorityStateItem = SoftConstraintPriority & {
  isActive: boolean;
};

function previewWeight(index: number, total: number) {
  return Math.max(1, total - index) * 5;
}

function withActiveState(items: SoftConstraintPriority[]): PriorityStateItem[] {
  return items.map((item) => ({
    ...item,
    isActive: item.isActive ?? item.weight > 0,
  }));
}

function partitionPriorities(items: PriorityStateItem[]) {
  return [...items.filter((item) => item.isActive), ...items.filter((item) => !item.isActive)];
}

function activeCodes(items: SoftConstraintPriority[]) {
  return partitionPriorities(withActiveState(items))
    .filter((item) => item.isActive)
    .map((item) => item.constraint_code);
}

export default function PriorityRankingsPage() {
  const [priorities, setPriorities] = useSessionState<PriorityStateItem[]>("soft.priorities", []);
  const [dirty, setDirty] = useSessionState("soft.dirty", false);
  const [error, setError] = useSessionState<string | null>("priorityRankings.error", null);
  const [success, setSuccess] = useSessionState<string | null>("priorityRankings.success", null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextPriorities = await getSoftConstraintPriorities();
      setPriorities(partitionPriorities(withActiveState(nextPriorities)));
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load priority rankings");
    } finally {
      setLoading(false);
    }
  }, [setDirty, setError, setPriorities]);

  useEffect(() => {
    if (priorities.length === 0) {
      void load();
    }
  }, [load, priorities.length]);

  const rankedPriorities = useMemo(() => {
    const ordered = partitionPriorities(withActiveState(priorities));
    const activeTotal = ordered.filter((item) => item.isActive).length;
    let activeRank = 0;
    return ordered.map((item) => {
      if (!item.isActive) {
        return {
          ...item,
          rank: null,
          weight: 0,
        };
      }
      activeRank += 1;
      return {
        ...item,
        rank: activeRank,
        weight: dirty ? previewWeight(activeRank - 1, activeTotal) : item.weight,
      };
    });
  }, [dirty, priorities]);

  const movePriority = (index: number, direction: -1 | 1) => {
    setPriorities((current) => {
      const next = partitionPriorities(withActiveState(current));
      const activeTotal = next.filter((item) => item.isActive).length;
      const target = index + direction;
      if (!next[index]?.isActive || target < 0 || target >= activeTotal) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return partitionPriorities(next);
    });
    setDirty(true);
    setSuccess(null);
  };

  const togglePriority = (constraintCode: string, isActive: boolean) => {
    setPriorities((current) =>
      partitionPriorities(
        withActiveState(current).map((item) =>
          item.constraint_code === constraintCode
            ? {
                ...item,
                isActive,
              }
            : item,
        ),
      ),
    );
    setDirty(true);
    setSuccess(null);
  };

  const savePriorities = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await updateSoftConstraintPriorities(activeCodes(priorities));
      setPriorities(partitionPriorities(withActiveState(saved)));
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
          <h1>Priority Rankings</h1>
          <p>Review and order soft constraint weights before timetable generation.</p>
        </div>
        <div className="toolbar-row">
          <button className="button secondary" onClick={() => void load()} disabled={loading || saving}>
            <RefreshCw className={loading ? "spin" : ""} size={17} />
            Refresh
          </button>
          <a className="button" href="#workflow/generate">
            Next: Generate Timetable
          </a>
        </div>
      </div>

      {error && <div className="notice bad">{error}</div>}
      {success && <div className="notice good">{success}</div>}
      {loading && (
        <InlineActivity
          kind="validate"
          title="Loading priority rankings"
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
        onToggle={togglePriority}
      />
    </div>
  );
}
