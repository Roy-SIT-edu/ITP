/*
 * Dashboard page.
 * Shows current import/validation/generation metrics; the flow chart lives in the global layout.
 */

import {
  AlertTriangle,
  CalendarDays,
  CalendarCheck,
  FileSpreadsheet,
  Info,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { getAvailability, getConstraintInsights, getDashboard } from "../api/client";
import type { Availability, ConstraintInsights, Dashboard } from "../types";
import StatusBadge from "../components/StatusBadge";

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [insights, setInsights] = useState<ConstraintInsights | null>(null);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    Promise.all([getDashboard(), getConstraintInsights(), getAvailability()])
      .then(([nextDashboard, nextInsights, nextAvailability]) => {
        setDashboard(nextDashboard);
        setInsights(nextInsights);
        setAvailability(nextAvailability);
      })
      .catch((err: Error) => setError(err.message));
  };

  useEffect(load, []);

  if (error) return <div className="notice bad">{error}</div>;
  if (!dashboard) return <div className="empty-state">Loading dashboard.</div>;

  const latest = dashboard.latest_schedule;
<<<<<<< Updated upstream
  const kpis = [
    {
      label: "Total sessions",
      value: dashboard.total_sessions,
      icon: CalendarDays,
      tone: "blue",
=======
  const quality = latest?.quality;
  const scheduledCount = latest?.scheduled_count ?? 0;
  const coveragePercent = dashboard.total_sessions ? Math.round((scheduledCount / dashboard.total_sessions) * 100) : 0;
  const hardConflicts = latest?.hard_violation_count ?? 0;
  const softWarnings = quality?.soft_warning_count ?? 0;
  const readiness = dashboardReadiness(dashboard);
  const ReadinessIcon = readiness.icon;
  const labRows = Math.max(0, dashboard.total_sessions - dashboard.imported_rows);

  const kpis = [
    {
      label: "Schedule coverage",
      value: `${scheduledCount}/${dashboard.total_sessions}`,
      detail: latest ? `${coveragePercent}% of sessions placed` : "Generate a schedule to measure coverage",
      icon: CalendarCheck,
      tone: coveragePercent === 100 ? "success" : "blue",
      badge: latest ? (
        <StatusBadge label={`${coveragePercent}%`} tone={coveragePercent === 100 ? "good" : "info"} />
      ) : null,
>>>>>>> Stashed changes
    },
    {
      label: "Imported rows",
      value: dashboard.imported_rows,
      icon: FileSpreadsheet,
      tone: "teal",
    },
    {
      label: "Validation",
      value: dashboard.validation.error_count,
      icon: ShieldCheck,
      tone: dashboard.validation.is_valid ? "success" : "error",
      badge: (
        <StatusBadge
          label={dashboard.validation.is_valid ? "Valid" : "Needs fixes"}
          tone={dashboard.validation.is_valid ? "good" : "bad"}
        />
      ),
      helper: (
        <span
          title={
            "Input validation checks uploaded session data for missing or invalid fields. Schedule issues are constraint violations detected after generating a timetable (conflicts in scheduled sessions)."
          }
        >
          <Info size={14} />
        </span>
      ),
    },
    {
      label: "Schedule",
      value: latest?.solver_status ?? "None",
      icon: CalendarCheck,
      tone: "indigo",
      badge: <StatusBadge label={latest?.status ?? "No run"} tone={latest ? "info" : "neutral"} />,
    },
    {
      label: "Hard conflicts",
      value: latest?.hard_violation_count ?? 0,
      icon: AlertTriangle,
<<<<<<< Updated upstream
      tone: (latest?.hard_violation_count ?? 0) > 0 ? "error" : "success",
    },
    {
      label: "Soft score",
      value: latest?.soft_score ?? 0,
=======
      tone: hardConflicts > 0 ? "error" : "success",
      badge: latest ? (
        <StatusBadge
          label={hardConflicts > 0 ? "Blocked" : "Conflict-free"}
          tone={hardConflicts > 0 ? "bad" : "good"}
        />
      ) : null,
    },
    {
      label: "Soft warnings",
      value: softWarnings,
      detail: quality ? `${quality.affected_session_count} sessions affected` : "Measured after generation",
      icon: CalendarDays,
      tone: softWarnings > 0 ? "warning" : "teal",
      badge: quality ? (
        <StatusBadge label={softWarnings > 0 ? "Reviewable" : "Clear"} tone={softWarnings > 0 ? "warn" : "good"} />
      ) : null,
    },
    {
      label: "Quality score",
      value: quality ? `${quality.score}/100` : "Not scored",
      detail: quality?.summary ?? "Generate a timetable to calculate quality",
>>>>>>> Stashed changes
      icon: Sparkles,
      tone: "purple",
    },
  ];

  return (
    <div className="page dashboard-page">
      <section className="dashboard-hero">
        <div className="page-header dashboard-page-header">
          <div>
            <h1>Overview</h1>
            <p>Academic timetable scheduling status</p>
          </div>
          <div className="toolbar-row">
            <button className="button secondary" onClick={load}>
              <RefreshCw size={17} />
              Refresh
            </button>
          </div>
        </div>

        <div className="metric-grid dashboard-metrics">
          {kpis.map((item) => {
            const Icon = item.icon;
            return (
              <div className="metric-card" key={item.label}>
                <div className={`metric-icon ${item.tone}`}>
                  <Icon size={20} />
                </div>
                <span>{item.label}</span>
                <div className="metric-value-row">
                  <strong>{item.value}</strong>
                  {item.helper}
                </div>
                {item.badge}
              </div>
            );
          })}
        </div>
      </section>

      <section className="dashboard-grid dashboard-insights">
        <div className="status-card">
          <div className="section-heading">
            <div>
              <div className="status-card-title">Smart Constraint Dashboard</div>
              <p>Highest priority validation and schedule issues</p>
            </div>
<<<<<<< Updated upstream
=======
            <a className="button secondary slim" href={dashboard.validation.error_count > 0 ? "#upload" : "#review"}>
              Open {dashboard.validation.error_count > 0 ? "input" : "review"}
              <ArrowRight size={15} />
            </a>
>>>>>>> Stashed changes
          </div>
          {insights && insights.top_issues.length > 0 ? (
<<<<<<< Updated upstream
            <div className="issue-stack">
              {insights.top_issues.slice(0, 6).map((issue) => (
                <div className="issue-pill" key={issue.code}>
                  <span>{issue.code.split("_").join(" ")}</span>
                  <strong>{issue.count}</strong>
=======
            <div className="dashboard-issue-list">
              {insights.top_issues.slice(0, 6).map((issue, index) => (
                <div className="dashboard-issue-row" key={issue.code}>
                  <span className="dashboard-issue-rank">{index + 1}</span>
                  <div>
                    <strong>{formatIssueLabel(issue.code)}</strong>
                    <small>{issueSource(issue.code)} issue</small>
                  </div>
                  <StatusBadge
                    label={issue.severity === "HARD" ? "Hard" : "Soft"}
                    tone={issue.severity === "HARD" ? "bad" : "warn"}
                  />
                  <strong className="dashboard-issue-count">{issue.count}</strong>
>>>>>>> Stashed changes
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">No current constraint issues.</div>
          )}
        </div>

        <div className="status-card">
          <div className="section-heading">
            <div>
              <div className="status-card-title">Staff Availability</div>
              <p>Current teaching load by day</p>
            </div>
          </div>
          <AvailabilityList
            emptyText="Generate a timetable to see staff load."
            items={availability?.staff.map((item) => ({ label: item.name, busy: item.busy })) ?? []}
          />
        </div>

<<<<<<< Updated upstream
        <div className="status-card">
          <div className="section-heading">
            <div>
              <div className="status-card-title">Room Availability</div>
              <p>Current room usage by day</p>
            </div>
          </div>
          <AvailabilityList
            emptyText="Generate a timetable to see room usage."
            items={availability?.rooms.map((item) => ({ label: item.room_code, busy: item.busy })) ?? []}
          />
        </div>
=======
          {quality ? (
            <>
              <div className="dashboard-quality-summary">
                <div
                  className="dashboard-quality-ring"
                  style={{ "--quality-score": `${quality.score}%` } as CSSProperties}
                >
                  <span>
                    <strong>{quality.score}</strong>
                    <small>/100</small>
                  </span>
                </div>
                <div>
                  <StatusBadge label={quality.label} tone={quality.tone} />
                  <p>{quality.summary}</p>
                </div>
              </div>
              <div className="dashboard-quality-facts">
                <QualityFact
                  label="Sessions affected"
                  value={`${quality.affected_session_count} (${quality.affected_session_percent}%)`}
                />
                <QualityFact label="Soft warnings" value={quality.soft_warning_count} />
                <QualityFact label="Preference pressure" value={`${quality.soft_pressure_per_session}/session`} />
              </div>
              {latest && (
                <a className="button secondary" href={`#run-report/${latest.id}`}>
                  View full run report
                  <ArrowRight size={16} />
                </a>
              )}
            </>
          ) : (
            <div className="empty-state">Generate a timetable to see its quality breakdown.</div>
          )}
        </article>
>>>>>>> Stashed changes
      </section>
    </div>
  );
}

function AvailabilityList({
  items,
  emptyText,
}: {
  items: { label: string; busy: { day: string }[] }[];
  emptyText: string;
}) {
  if (items.length === 0) {
    return <div className="empty-state">{emptyText}</div>;
  }
  const days = [
    ["Monday", "Mon"],
    ["Tuesday", "Tue"],
    ["Wednesday", "Wed"],
    ["Thursday", "Thu"],
    ["Friday", "Fri"],
  ];
  return (
    <div className="availability-list">
      <div className="availability-header" aria-hidden="true">
        <span>Resource</span>
        {days.map(([day, label]) => (
          <small key={day}>{label}</small>
        ))}
      </div>
      {items.slice(0, 6).map((item) => (
        <AvailabilityRow days={days} item={item} key={item.label} />
      ))}
      {items.length > 6 && <span className="muted">Showing 6 of {items.length}</span>}
      <div className="heatmap-legend" aria-label="Teaching load colour legend">
        <span>
          <i className="heat-0" />0
        </span>
        <span>
          <i className="heat-1" />1
        </span>
        <span>
          <i className="heat-2" />2
        </span>
        <span>
          <i className="heat-4" />
          3-4
        </span>
        <span>
          <i className="heat-5" />
          5+
        </span>
      </div>
    </div>
  );
}

function AvailabilityRow({ days, item }: { days: string[][]; item: { label: string; busy: { day: string }[] } }) {
  const counts = item.busy.reduce<Record<string, number>>((current, entry) => {
    current[entry.day] = (current[entry.day] ?? 0) + 1;
    return current;
  }, {});

  return (
    <div className="availability-row">
      <span className="availability-name" title={item.label}>
        {item.label}
      </span>
      {days.map(([day]) => (
        <small className={`heat-cell ${heatClass(counts[day] ?? 0)}`} key={day} title={`${day}: ${counts[day] ?? 0}`}>
          {counts[day] ?? 0}
        </small>
      ))}
    </div>
  );
}

<<<<<<< Updated upstream
function heatClass(value: number) {
  if (value === 0) return "heat-0";
  if (value === 1) return "heat-1";
  if (value === 2) return "heat-2";
  if (value <= 4) return "heat-4";
  return "heat-5";
=======
function formatIssueLabel(code: string) {
  return code
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function issueSource(code: string) {
  return code.includes("_") && code === code.toUpperCase() ? "Schedule" : "Input";
}

function formatStatus(status: string) {
  return status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Latest run";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
>>>>>>> Stashed changes
}
