import { ArrowDown, ArrowUp, ChevronDown, Play, RefreshCw, Save, Search } from "lucide-react";
import { useMemo, useState } from "react";
import StatusBadge from "./StatusBadge";
import type { ScheduleGenerateResult, SessionRow, SoftConstraintPriority } from "../types";

export type RankedSoftPriority = SoftConstraintPriority & {
  rank: number;
  weight: number;
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
  canGenerate,
  dirty,
  generating,
  generationResult,
  hasHardErrors,
  priorityCount,
  readinessText,
  saving,
  softRowCount,
  validationLoaded,
  warningCount,
  onGenerate,
}: {
  canGenerate: boolean;
  dirty: boolean;
  generating: boolean;
  generationResult: ScheduleGenerateResult | null;
  hasHardErrors: boolean;
  priorityCount: number;
  readinessText: string;
  saving: boolean;
  softRowCount: number;
  validationLoaded: boolean;
  warningCount: number;
  onGenerate: () => void;
}) {
  const blocked = hasHardErrors || !validationLoaded;

  return (
    <section className="status-card generation-panel">
      <div className="generation-copy">
        <div className="status-card-title">Generation Readiness</div>
        <div className="status-row">
          <StatusBadge label={blocked ? "Blocked" : "Ready"} tone={blocked ? "bad" : "good"} />
          <span>{readinessText}</span>
        </div>
        <div className="soft-summary-row">
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
      <div className="generation-actions">
        <button className="button large" disabled={!canGenerate || generating || saving} onClick={onGenerate}>
          {generating ? <RefreshCw className="spin" size={18} /> : <Play size={18} />}
          {generating ? "Running Solver" : "Generate Timetable"}
        </button>
        {dirty && <span className="muted">Unsaved ranking will be saved first.</span>}
      </div>
      {generationResult && (
        <div className="result-strip">
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
            Soft <strong>{generationResult.soft_score}</strong>
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
}: {
  dirty: boolean;
  generating: boolean;
  priorities: RankedSoftPriority[];
  saving: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onSave: () => void;
}) {
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
          {priorities.map((item, index) => (
            <div className="priority-row" key={item.constraint_code}>
              <div className="priority-rank">
                <span>Rank</span>
                <strong>{item.rank}</strong>
              </div>
              <div className="priority-main">
                <strong>{item.label}</strong>
                <span>{item.description}</span>
                <small>{item.constraint_code}</small>
              </div>
              <div className="priority-weight">
                <span>Weight</span>
                <strong>{item.weight}</strong>
              </div>
              <div className="priority-controls">
                <button
                  className="button secondary slim"
                  type="button"
                  title={`Move ${item.label} up`}
                  disabled={index === 0 || saving || generating}
                  onClick={() => onMove(index, -1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  className="button secondary slim"
                  type="button"
                  title={`Move ${item.label} down`}
                  disabled={index === priorities.length - 1 || saving || generating}
                  onClick={() => onMove(index, 1)}
                >
                  <ArrowDown size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function SoftPreferenceTable({
  rows,
  warningCount,
}: {
  rows: SoftPreferenceRow[];
  warningCount: number;
}) {
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
    <details className="status-card preference-dropdown" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
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
                                <span className={`preference-chip ${hint.tone}`} key={`${session.id}-${hint.label}-${hint.value}`}>
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
