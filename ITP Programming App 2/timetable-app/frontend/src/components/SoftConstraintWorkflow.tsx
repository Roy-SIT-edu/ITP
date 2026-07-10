import { ArrowDown, ArrowUp, ChevronDown, Play, RefreshCw, Save, Search } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import StatusBadge from "./StatusBadge";
import type { ScheduleGenerateResult, SessionRow, SoftConstraintPriority } from "../types";

export type RankedSoftPriority = SoftConstraintPriority & {
  rank: number;
  weight: number;
  isActive: boolean;
};

export type SoftPreferenceHint = {
  label: string;
  value: string;
  tone: "preferred" | "avoid" | "online" | "remarks";
};

export type SoftPreferenceRow = {
  session: SessionRow;
  hints: SoftPreferenceHint[];
};

type PreferenceFilter = "all" | SoftPreferenceHint["tone"];

const preferenceFilters: { tone: PreferenceFilter; label: string }[] = [
  { tone: "all", label: "All" },
  { tone: "preferred", label: "Preferred" },
  { tone: "avoid", label: "Avoid" },
  { tone: "online", label: "Online" },
  { tone: "remarks", label: "Notes" },
];

export function GenerationReadinessPanel({
  importedRowCount,
  priorityCount,
  readinessText,
  softRowCount,
  warningCount,
}: {
  importedRowCount?: number;
  priorityCount: number;
  readinessText: string;
  softRowCount: number;
  warningCount: number;
}) {
  const blocked = importedRowCount === 0;

  return (
    <section className="status-card generation-panel generation-panel-readiness">
      <div className="generation-copy">
        <div className="status-card-title">Generation Readiness</div>
        <div className="status-row">
          <StatusBadge label={blocked ? "Blocked" : "Ready"} tone={blocked ? "bad" : "good"} />
          <span>{readinessText}</span>
        </div>
        <div className="soft-summary-row">
          {typeof importedRowCount === "number" && (
            <span>
              <strong>{importedRowCount}</strong> imported rows
            </span>
          )}
          <span>
            <strong>{priorityCount}</strong> priorities
          </span>
          <span>
            <strong>{softRowCount}</strong> soft rows
          </span>
          <span>
            <strong>{warningCount}</strong> warnings
          </span>
        </div>
      </div>
    </section>
  );
}

export function GenerationActionPanel({
  canGenerate,
  dirty,
  generating,
  generationResult,
  saving,
  onGenerate,
}: {
  canGenerate: boolean;
  dirty: boolean;
  generating: boolean;
  generationResult: ScheduleGenerateResult | null;
  saving: boolean;
  onGenerate: () => void;
}) {
  return (
    <section className="status-card generation-panel">
      <div className="generation-copy">
        <div className="status-card-title">Run Timetable Generation</div>
        <div className="status-row">
          <StatusBadge label="Ready" tone="good" />
          <span>Ready to generate.</span>
        </div>
      </div>
      <div className="generation-actions">
        <button className="button large" disabled={!canGenerate || generating || saving} onClick={onGenerate}>
          {generating ? <RefreshCw className="spin" size={18} /> : <Play size={18} />}
          {generating ? "Running Solver" : "Generate Timetable"}
        </button>
        {dirty && <span className="muted">Unsaved ranking will be saved first.</span>}
      </div>
      {generationResult && (
        <div className="result-strip">
          {generationResult.quality && (
            <span title={generationResult.quality.summary}>
              Quality <strong>{generationResult.quality.score}/100</strong> {generationResult.quality.label}
            </span>
          )}
          <span>
            Run <strong>{generationResult.schedule_run_id}</strong>
          </span>
          <span>
            Solver <strong>{generationResult.solver_status}</strong>
          </span>
          <span>
            Hard <strong>{generationResult.hard_violation_count}</strong>
          </span>
          <span>
            Soft Warnings{" "}
            <strong>{generationResult.quality?.soft_warning_count ?? generationResult.soft_warning_count ?? 0}</strong>
          </span>
        </div>
      )}
    </section>
  );
}

export function PriorityRanking({
  dirty,
  generating,
  priorities,
  saving,
  onMove,
  onSave,
  onToggle,
}: {
  dirty: boolean;
  generating: boolean;
  priorities: RankedSoftPriority[];
  saving: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onSave: () => void;
  onToggle: (constraintCode: string, isActive: boolean) => void;
}) {
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const previousRects = useRef(new Map<string, DOMRect>());
  const activeCount = priorities.filter((item) => item.isActive).length;

  const setRowRef = (code: string) => (element: HTMLDivElement | null) => {
    if (element) {
      rowRefs.current.set(code, element);
    } else {
      rowRefs.current.delete(code);
    }
  };

  const captureRowPositions = () => {
    previousRects.current = new Map(
      Array.from(rowRefs.current.entries()).map(([code, element]) => [code, element.getBoundingClientRect()]),
    );
  };

  const moveWithAnimation = (index: number, direction: -1 | 1) => {
    captureRowPositions();
    onMove(index, direction);
  };

  const toggleWithAnimation = (constraintCode: string, isActive: boolean) => {
    captureRowPositions();
    onToggle(constraintCode, isActive);
  };

  useLayoutEffect(() => {
    if (previousRects.current.size === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      previousRects.current.clear();
      return;
    }

    rowRefs.current.forEach((element, code) => {
      const previous = previousRects.current.get(code);
      if (!previous) return;
      const next = element.getBoundingClientRect();
      const deltaY = previous.top - next.top;
      if (Math.abs(deltaY) < 1) return;

      element.animate(
        [
          { transform: `translateY(${deltaY}px)`, boxShadow: "0 8px 20px rgba(79, 70, 229, 0.14)" },
          { transform: "translateY(0)", boxShadow: "0 0 0 rgba(79, 70, 229, 0)" },
        ],
        {
          duration: 240,
          easing: "cubic-bezier(0.2, 0, 0.2, 1)",
        },
      );
    });

    previousRects.current.clear();
  }, [priorities]);

  return (
    <section className="status-card priority-section">
      <div className="section-heading">
        <div>
          <div className="status-card-title">Priority Ranking</div>
          <p>{dirty ? "Unsaved changes" : "Saved ranking"}</p>
        </div>
        <button className="button secondary" onClick={onSave} disabled={!dirty || saving || generating}>
          <Save size={17} />
          {saving ? "Saving" : "Save Ranking"}
        </button>
      </div>

      {priorities.length === 0 ? (
        <div className="empty-state">No soft constraints are available.</div>
      ) : (
        <div className="priority-list">
          {priorities.map((item, index) => {
            const isActive = item.isActive;
            return (
              <div
                className={`priority-row ${isActive ? "active" : "inactive"}`}
                key={item.constraint_code}
                ref={setRowRef(item.constraint_code)}
              >
                <div className="priority-rank">
                  {isActive ? (
                    <>
                      <span>Rank</span>
                      <strong>{item.rank}</strong>
                    </>
                  ) : (
                    <StatusBadge label="Inactive" tone="neutral" />
                  )}
                </div>
                <div className="priority-main">
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                  <small>{item.constraint_code}</small>
                </div>
                <div className="priority-weight" aria-hidden="true">
                  <span>Weight</span>
                  <strong className="priority-weight-value" aria-hidden="true">
                    {item.weight}
                  </strong>
                </div>
                <div className="priority-controls">
                  <label
                    className={`priority-switch ${saving || generating ? "disabled" : ""}`}
                    title={`${isActive ? "Disable" : "Enable"} ${item.label}`}
                  >
                    <input
                      checked={isActive}
                      disabled={saving || generating}
                      type="checkbox"
                      onChange={(event) => toggleWithAnimation(item.constraint_code, event.target.checked)}
                    />
                    <span className="priority-switch-track" aria-hidden="true">
                      <span className="priority-switch-thumb" />
                    </span>
                    <span className="priority-switch-label">{isActive ? "Active" : "Off"}</span>
                  </label>
                  <button
                    className="button secondary slim"
                    type="button"
                    title={`Move ${item.label} up`}
                    disabled={!isActive || index === 0 || saving || generating}
                    onClick={() => moveWithAnimation(index, -1)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    className="button secondary slim"
                    type="button"
                    title={`Move ${item.label} down`}
                    disabled={!isActive || index >= activeCount - 1 || saving || generating}
                    onClick={() => moveWithAnimation(index, 1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function SoftPreferenceTable({ rows, warningCount }: { rows: SoftPreferenceRow[]; warningCount: number }) {
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<PreferenceFilter>("all");
  const [expanded, setExpanded] = useState(false);

  const counts = useMemo(
    () =>
      rows.reduce<Record<PreferenceFilter, number>>(
        (current, row) => {
          current.all += 1;
          row.hints.forEach((hint) => {
            current[hint.tone] += 1;
          });
          return current;
        },
        { all: 0, preferred: 0, avoid: 0, online: 0, remarks: 0 },
      ),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return rows.filter(({ session, hints }) => {
      const matchesFilter = activeFilter === "all" || hints.some((hint) => hint.tone === activeFilter);
      if (!matchesFilter) return false;
      if (!search) return true;
      return [
        session.requirement_id,
        session.module_code,
        session.student_group_code,
        ...hints.flatMap((hint) => [hint.label, hint.value]),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });
  }, [activeFilter, query, rows]);

  return (
    <details
      className="status-card preference-dropdown"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="preference-summary">
        <div>
          <div className="status-card-title">Soft Preferences In Current Input</div>
          <p>
            {rows.length} requirement{rows.length === 1 ? "" : "s"} with soft preferences
          </p>
        </div>
        <div className="preference-summary-meta">
          {warningCount > 0 && (
            <span className="preference-warning">
              {warningCount} warning{warningCount === 1 ? "" : "s"}
            </span>
          )}
          <span className="preference-toggle">
            {expanded ? "Hide" : "Show"}
            <ChevronDown size={16} />
          </span>
        </div>
      </summary>

      <div className="preference-content">
        {warningCount > 0 && (
          <div className="notice bad">
            {warningCount} soft-input warning{warningCount === 1 ? "" : "s"} found.
          </div>
        )}
        {rows.length === 0 ? (
          <div className="empty-state">No row-level soft preferences were found in the imported requirements.</div>
        ) : (
          <>
            <div className="preference-tools">
              <label className="preference-search">
                <Search size={16} />
                <input
                  placeholder="Search requirement, module, group, or notes..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <div className="preference-filter-row">
                {preferenceFilters.map((filter) => (
                  <button
                    className={`preference-filter ${activeFilter === filter.tone ? "active" : ""}`}
                    key={filter.tone}
                    type="button"
                    onClick={() => setActiveFilter(filter.tone)}
                  >
                    {filter.label}
                    <strong>{counts[filter.tone]}</strong>
                  </button>
                ))}
              </div>
            </div>

            {filteredRows.length === 0 ? (
              <div className="empty-state">No soft preferences match the current filter.</div>
            ) : (
              <div className="preference-list-shell">
                <div className="preference-list">
                  {filteredRows.map(({ session, hints }) => {
                    const notes = hints.filter((hint) => hint.tone === "remarks");
                    const chips = hints.filter((hint) => hint.tone !== "remarks");
                    return (
                      <article className="preference-item" key={session.id}>
                        <div className="preference-item-header">
                          <div>
                            <strong>{session.requirement_id ?? `Row ${session.source_row_no ?? session.id}`}</strong>
                            <span>{session.module_code || "No module code"}</span>
                          </div>
                          <small>{session.student_group_code || "No group"}</small>
                        </div>
                        <div className="preference-detail">
                          {chips.length > 0 && (
                            <div className="preference-chip-row">
                              {chips.map((hint) => (
                                <span
                                  className={`preference-chip ${hint.tone}`}
                                  key={`${session.id}-${hint.label}-${hint.value}`}
                                >
                                  <strong>{hint.label}</strong>
                                  {hint.value}
                                </span>
                              ))}
                            </div>
                          )}
                          {notes.map((hint) => (
                            <div className="preference-note" key={`${session.id}-${hint.value}`} title={hint.value}>
                              <strong>{hint.label}</strong>
                              <span>{hint.value}</span>
                            </div>
                          ))}
                        </div>
                      </article>
                    );
                  })}
                </div>
                <div className="preference-list-footer">
                  {filteredRows.length} matching preference{filteredRows.length === 1 ? "" : "s"}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
}
