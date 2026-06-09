/*
 * Diagnostic side drawer for generated schedule conflicts and guided fixes.
 */

import { AlertTriangle, BarChart3, CheckCircle2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getResolutionSuggestions } from "../api/client";
import type {
  ConstraintViolation,
  ResolutionSuggestion,
  Room,
  ScheduleComparison,
  ScheduleExplanation,
  ScheduledRow,
  SoftConstraintPriority,
} from "../types";
import StatusBadge from "./StatusBadge";

type AuditFilter = "all" | "room" | "staff" | "student" | "hard" | "soft";
type ResolutionFilter = "all" | "pending" | "in_progress" | "resolved";
type SortKey = "impact" | "severity" | "category" | "code" | "sessions";

type AuditRow = ConstraintViolation & {
  category: string;
  impactScore: number;
  priorityWeight: number;
  tier: "critical" | "minor";
  status: "Pending";
};

type Props = {
  open: boolean;
  onClose: () => void;
  violations: ConstraintViolation[];
  explanations: ScheduleExplanation[];
  rows: ScheduledRow[];
  rooms: Room[];
  comparisons: ScheduleComparison[];
  scheduleRunId?: number | null;
  softPriorities?: SoftConstraintPriority[];
  applyingSessionId?: number | null;
  onSelectSession?: (sessionId: number) => void;
  onPreviewSuggestion?: (suggestion: ResolutionSuggestion | null) => void;
  onApplySuggestion?: (suggestion: ResolutionSuggestion) => Promise<void> | void;
};

const auditFilters: { key: AuditFilter; label: string }[] = [
  { key: "all", label: "All Issues" },
  { key: "room", label: "Room" },
  { key: "staff", label: "Staff" },
  { key: "student", label: "Student" },
  { key: "hard", label: "Hard" },
  { key: "soft", label: "Soft" },
];

const resolutionFilters: { key: ResolutionFilter; label: string }[] = [
  { key: "all", label: "All Status" },
  { key: "pending", label: "Pending" },
  { key: "in_progress", label: "In Progress" },
  { key: "resolved", label: "Resolved" },
];

export default function AuditSideDrawer({
  open,
  onClose,
  violations,
  explanations,
  rows,
  rooms,
  comparisons,
  scheduleRunId,
  softPriorities = [],
  applyingSessionId = null,
  onSelectSession,
  onPreviewSuggestion,
  onApplySuggestion,
}: Props) {
  const [filter, setFilter] = useState<AuditFilter>("all");
  const [resolutionFilter, setResolutionFilter] = useState<ResolutionFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("impact");
  const [activeViolationId, setActiveViolationId] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<ResolutionSuggestion[]>([]);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);

  const priorityWeights = useMemo(
    () => new Map(softPriorities.map((item) => [item.constraint_code, item.weight])),
    [softPriorities],
  );

  const auditRows = useMemo<AuditRow[]>(
    () =>
      violations.map((item) => {
        const priorityWeight = priorityWeights.get(item.constraint_code) ?? (item.severity === "HARD" ? 60 : 10);
        const score = impactScore(item, rows, priorityWeight);
        return {
          ...item,
          category: conflictCategory(item.constraint_code, item.message),
          impactScore: score,
          priorityWeight,
          tier: item.severity === "HARD" || score >= 60 ? "critical" : "minor",
          status: "Pending",
        };
      }),
    [priorityWeights, rows, violations],
  );

  const filteredRows = useMemo(() => {
    return auditRows
      .filter((item) => matchesAuditFilter(item, filter))
      .filter((item) => resolutionFilter === "all" || statusKey(item.status) === resolutionFilter)
      .sort((left, right) => compareAuditRows(left, right, sortKey));
  }, [auditRows, filter, resolutionFilter, sortKey]);

  useEffect(() => {
    if (!open) return;
    if (filteredRows.length === 0) {
      setActiveViolationId(null);
      return;
    }
    if (!filteredRows.some((item) => item.id === activeViolationId)) {
      setActiveViolationId(filteredRows[0].id);
    }
  }, [activeViolationId, filteredRows, open]);

  const activeViolation = filteredRows.find((item) => item.id === activeViolationId) ?? filteredRows[0] ?? null;
  const activeSessionRows = activeViolation ? relatedRows(rows, activeViolation.affected_session_ids) : [];
  const activeExplanations = activeViolation
    ? explanations.filter((item) => activeViolation.affected_session_ids.includes(item.session_id))
    : [];
  const hardCount = auditRows.filter((item) => item.severity === "HARD").length;
  const softCount = auditRows.filter((item) => item.severity === "SOFT").length;
  const utilization = roomUtilization(rows, rooms);
  const satisfaction = constraintSatisfactionScore(auditRows);
  const trendValues = comparisons
    .slice()
    .sort((left, right) => left.id - right.id)
    .slice(-8)
    .map((item) => item.stored_hard_issues + item.stored_soft_issues);
  const criticalRows = filteredRows.filter((item) => item.tier === "critical");
  const minorRows = filteredRows.filter((item) => item.tier === "minor");

  useEffect(() => {
    if (!open || !activeViolation?.affected_session_ids[0]) return;
    onSelectSession?.(activeViolation.affected_session_ids[0]);
  }, [activeViolation?.id, onSelectSession, open]);

  useEffect(() => {
    onPreviewSuggestion?.(null);
    if (!open || !scheduleRunId || !activeViolation) {
      setSuggestions([]);
      setSuggestionError(null);
      setSuggestionLoading(false);
      return;
    }
    let cancelled = false;
    setSuggestions([]);
    setSuggestionLoading(true);
    setSuggestionError(null);
    getResolutionSuggestions(scheduleRunId, activeViolation.id)
      .then((items) => {
        if (!cancelled) setSuggestions(items);
      })
      .catch((err) => {
        if (!cancelled) setSuggestionError(err instanceof Error ? err.message : "Could not load suggestions");
      })
      .finally(() => {
        if (!cancelled) setSuggestionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeViolation?.id, onPreviewSuggestion, open, scheduleRunId]);

  const chooseViolation = (item: AuditRow) => {
    setActiveViolationId(item.id);
    if (item.affected_session_ids[0]) {
      onSelectSession?.(item.affected_session_ids[0]);
    }
  };

  if (!open) return null;

  return (
    <div className="audit-drawer-layer" role="dialog" aria-modal="true" aria-label="Schedule audit">
      <button className="audit-drawer-backdrop" type="button" aria-label="Close schedule audit" onClick={onClose} />
      <aside className="audit-drawer">
        <header className="audit-drawer-header">
          <div>
            <span>Audit Center</span>
            <strong>Conflicts ({violations.length})</strong>
          </div>
          <button className="icon-button" type="button" aria-label="Close schedule audit" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <section className="audit-health-grid" aria-label="Audit statistics">
          <MetricTile label="Hard" value={hardCount} tone="bad" />
          <MetricTile label="Soft" value={softCount} tone="warn" />
          <MetricTile label="Utilization" value={`${utilization}%`} tone="good" />
          <MetricTile label="Satisfaction" value={`${satisfaction}%`} tone="good" />
        </section>

        <section className="audit-trend-panel">
          <div>
            <BarChart3 size={16} />
            <strong>Conflict Trend</strong>
          </div>
          <MiniTrend values={trendValues} />
        </section>

        <section className="audit-controls">
          <div className="audit-filter-row">
            {auditFilters.map((item) => (
              <button
                className={filter === item.key ? "active" : ""}
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="audit-filter-row compact">
            {resolutionFilters.map((item) => (
              <button
                className={resolutionFilter === item.key ? "active" : ""}
                key={item.key}
                type="button"
                onClick={() => setResolutionFilter(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <section className="audit-matrix">
          <div className="audit-section-title">
            <AlertTriangle size={16} />
            <strong>Conflict Matrix</strong>
          </div>
          <div className="audit-table-wrap">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>
                    <button type="button" onClick={() => setSortKey("impact")}>Impact</button>
                  </th>
                  <th>
                    <button type="button" onClick={() => setSortKey("severity")}>Severity</button>
                  </th>
                  <th>
                    <button type="button" onClick={() => setSortKey("category")}>Category</button>
                  </th>
                  <th>Status</th>
                  <th>
                    <button type="button" onClick={() => setSortKey("code")}>Rule</button>
                  </th>
                  <th>
                    <button type="button" onClick={() => setSortKey("sessions")}>Sessions</button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {renderTierRows("Critical Fixes", criticalRows, activeViolation, chooseViolation)}
                {renderTierRows("Minor Suggestions", minorRows, activeViolation, chooseViolation)}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={6}>No issues match this filter.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="audit-detail-pane">
          <div className="audit-section-title">
            <CheckCircle2 size={16} />
            <strong>Placement Logic</strong>
          </div>
          {activeViolation ? (
            <>
              <article className="audit-issue-card">
                <span>{activeViolation.category}</span>
                <strong>{activeViolation.constraint_code}</strong>
                <p>{activeViolation.message}</p>
                <div className="audit-impact-detail">
                  <strong>Impact {activeViolation.impactScore}</strong>
                  <small>{impactDescription(activeViolation)}</small>
                </div>
              </article>

              <div className="audit-linked-slots">
                {activeSessionRows.map((row) => (
                  <button key={row.session_id} type="button" onClick={() => onSelectSession?.(row.session_id)}>
                    <strong>{row.module_code ?? row.requirement_id ?? `Session ${row.session_id}`}</strong>
                    <span>{row.programme ?? "No programme"} | {row.day} {row.start_time}-{row.end_time} | {row.room}</span>
                  </button>
                ))}
                {activeSessionRows.length === 0 && <div className="empty-state">No linked scheduled sessions found.</div>}
              </div>

              <section className="audit-resolution-panel">
                <div className="audit-section-title compact">
                  <CheckCircle2 size={15} />
                  <strong>Suggested Fixes</strong>
                </div>
                {suggestionLoading && <div className="empty-state">Searching valid alternatives...</div>}
                {suggestionError && <div className="notice bad">{suggestionError}</div>}
                {!suggestionLoading && !suggestionError && suggestions.length === 0 && (
                  <div className="empty-state">No one-click fix is available for this issue yet.</div>
                )}
                <div className="audit-suggestion-list">
                  {suggestions.map((suggestion) => (
                    <article
                      className="audit-suggestion-card"
                      key={`${suggestion.session_id}-${suggestion.day}-${suggestion.start_time}-${suggestion.room_code}`}
                      onFocus={() => onPreviewSuggestion?.(suggestion)}
                      onBlur={() => onPreviewSuggestion?.(null)}
                      onMouseEnter={() => onPreviewSuggestion?.(suggestion)}
                      onMouseLeave={() => onPreviewSuggestion?.(null)}
                    >
                      <div>
                        <strong>{suggestion.summary}</strong>
                        <span>Fit {suggestion.score}</span>
                      </div>
                      <p>{suggestion.reason}</p>
                      <small>{suggestion.room_code}{suggestion.room_name ? ` | ${suggestion.room_name}` : ""}</small>
                      {suggestion.tradeoffs.length > 0 && (
                        <ul>
                          {suggestion.tradeoffs.map((tradeoff) => <li key={tradeoff}>{tradeoff}</li>)}
                        </ul>
                      )}
                      <button
                        className="button slim"
                        disabled={applyingSessionId === suggestion.session_id}
                        type="button"
                        onClick={() => onApplySuggestion?.(suggestion)}
                      >
                        {applyingSessionId === suggestion.session_id ? "Applying" : "Apply Move"}
                      </button>
                    </article>
                  ))}
                </div>
              </section>

              <div className="audit-explanation-list">
                {activeExplanations.map((item) => (
                  <article key={item.session_id}>
                    <strong>{item.module_code ?? item.requirement_id ?? `Session ${item.session_id}`}</strong>
                    <span>{item.placement}</span>
                    <ul>
                      {item.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                      {item.issues.map((issue) => <li key={issue.id}>{issue.constraint_code}: {issue.message}</li>)}
                    </ul>
                  </article>
                ))}
                {activeExplanations.length === 0 && <div className="empty-state">No placement explanation is available for this issue.</div>}
              </div>
            </>
          ) : (
            <div className="empty-state">Select an issue to inspect placement logic.</div>
          )}
        </section>
      </aside>
    </div>
  );
}

function renderTierRows(
  label: string,
  rows: AuditRow[],
  activeViolation: AuditRow | null,
  onChoose: (item: AuditRow) => void,
) {
  if (rows.length === 0) return null;
  return (
    <>
      <tr className="audit-tier-row">
        <td colSpan={6}>{label}</td>
      </tr>
      {rows.map((item) => (
        <tr
          className={activeViolation?.id === item.id ? "active" : ""}
          key={item.id}
          onClick={() => onChoose(item)}
        >
          <td>
            <strong className="audit-impact-score">{item.impactScore}</strong>
          </td>
          <td>
            <StatusBadge label={item.severity} tone={item.severity === "HARD" ? "bad" : "warn"} />
          </td>
          <td>{item.category}</td>
          <td><span className="audit-status pending">{item.status}</span></td>
          <td>{item.constraint_code}</td>
          <td>{item.affected_session_ids.join(", ")}</td>
        </tr>
      ))}
    </>
  );
}

function MetricTile({ label, value, tone }: { label: string; value: number | string; tone: "bad" | "warn" | "good" }) {
  return (
    <div className={`audit-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MiniTrend({ values }: { values: number[] }) {
  if (values.length === 0) {
    return <div className="audit-trend-empty">No trend data</div>;
  }
  const max = Math.max(1, ...values);
  const points = values
    .map((value, index) => {
      const x = values.length === 1 ? 50 : (index / (values.length - 1)) * 100;
      const y = 36 - (value / max) * 30;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg className="audit-trend-chart" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}

function conflictCategory(code: string, message: string) {
  const text = `${code} ${message}`.toLowerCase();
  if (text.includes("room") || text.includes("capacity") || text.includes("venue")) return "Room Conflicts";
  if (text.includes("staff") || text.includes("tutor") || text.includes("professor")) return "Staff Conflicts";
  if (text.includes("student") || text.includes("group")) return "Student Conflicts";
  return "Schedule Rules";
}

function matchesAuditFilter(item: AuditRow, filter: AuditFilter) {
  if (filter === "all") return true;
  if (filter === "hard") return item.severity === "HARD";
  if (filter === "soft") return item.severity === "SOFT";
  if (filter === "room") return item.category === "Room Conflicts";
  if (filter === "staff") return item.category === "Staff Conflicts";
  if (filter === "student") return item.category === "Student Conflicts";
  return true;
}

function statusKey(status: AuditRow["status"]) {
  return status.toLowerCase().replace(/\s+/g, "_") as ResolutionFilter;
}

function compareAuditRows(left: AuditRow, right: AuditRow, sortKey: SortKey) {
  if (sortKey === "impact") {
    return right.impactScore - left.impactScore || left.constraint_code.localeCompare(right.constraint_code);
  }
  if (sortKey === "severity") {
    const severityOrder = { HARD: 0, SOFT: 1 };
    return severityOrder[left.severity] - severityOrder[right.severity] || left.constraint_code.localeCompare(right.constraint_code);
  }
  if (sortKey === "category") return left.category.localeCompare(right.category);
  if (sortKey === "sessions") return left.affected_session_ids.length - right.affected_session_ids.length;
  return left.constraint_code.localeCompare(right.constraint_code);
}

function impactScore(item: ConstraintViolation, rows: ScheduledRow[], priorityWeight: number) {
  const related = relatedRows(rows, item.affected_session_ids);
  const base = item.severity === "HARD" ? 70 : 25;
  const peopleProxy = related.reduce((total, row) => total + (row.student_group_code ? 8 : 3), 0);
  const pairPressure = Math.max(0, item.affected_session_ids.length - 1) * 8;
  return Math.min(100, base + priorityWeight + peopleProxy + pairPressure);
}

function impactDescription(item: AuditRow) {
  if (item.severity === "HARD") {
    return "This can make the timetable physically impossible until it is resolved.";
  }
  if (item.constraint_code === "CLASS_AFTER_1700") {
    return "This creates a late teaching slot and breaches the configured latest-class rule.";
  }
  if (item.category === "Student Conflicts") {
    return "This affects the student experience and should be reviewed before export.";
  }
  return "This is a preference or quality issue; fixing higher scores first gives the biggest improvement.";
}

function relatedRows(rows: ScheduledRow[], sessionIds: number[]) {
  const ids = new Set(sessionIds);
  return rows.filter((row) => ids.has(row.session_id));
}

function roomUtilization(rows: ScheduledRow[], rooms: Room[]) {
  if (rooms.length === 0) return 0;
  const usedRooms = new Set(rows.map((row) => row.room).filter(Boolean));
  return Math.round((usedRooms.size / rooms.length) * 100);
}

function constraintSatisfactionScore(rows: AuditRow[]) {
  if (rows.length === 0) return 100;
  const hard = rows.filter((item) => item.severity === "HARD").length;
  const soft = rows.length - hard;
  return Math.max(0, 100 - hard * 15 - soft * 4);
}
