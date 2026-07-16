/*
 * Operational dashboard for timetable readiness and schedule health.
 */

import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  FileSpreadsheet,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useState } from "react";
import { exportUrl, getConstraintInsights, getDashboard } from "../api/client";
import OptimisedScoreInfo from "../components/OptimisedScoreInfo";
import StatusBadge from "../components/StatusBadge";
import type { ConstraintInsights, Dashboard } from "../types";

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [insights, setInsights] = useState<ConstraintInsights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextDashboard, nextInsights] = await Promise.all([getDashboard(), getConstraintInsights()]);
      setDashboard(nextDashboard);
      setInsights(nextInsights);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !dashboard) return <div className="notice bad">{error}</div>;
  if (!dashboard) return <div className="empty-state">Loading dashboard.</div>;

  const latest = dashboard.latest_schedule;
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
    },
    {
      label: "Input errors",
      value: dashboard.validation.error_count,
      detail: `${dashboard.validation.warning_count} additional input warnings`,
      icon: ShieldAlert,
      tone: dashboard.validation.error_count > 0 ? "error" : "success",
      badge: (
        <StatusBadge
          label={dashboard.validation.error_count > 0 ? "Needs attention" : "Inputs valid"}
          tone={dashboard.validation.error_count > 0 ? "bad" : "good"}
        />
      ),
    },
    {
      label: "Hard conflicts",
      value: hardConflicts,
      detail: latest ? "Blocking schedule issues" : "No generated schedule yet",
      icon: AlertTriangle,
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
      icon: Sparkles,
      tone: "purple",
      badge: quality ? <StatusBadge label={quality.label} tone={quality.tone} /> : null,
    },
  ];

  return (
    <div className="page dashboard-page dashboard-page-v2">
      <section className="dashboard-hero dashboard-control-centre">
        <div className="page-header dashboard-page-header">
          <div>
            <span className="dashboard-eyebrow">Scheduling control centre</span>
            <h1>Overview</h1>
            <p>
              {dashboard.imported_rows} uploaded requirements and {labRows} lab bookings in the current input
            </p>
          </div>
          <div className="toolbar-row">
            <button className="button secondary" disabled={loading} onClick={() => void load()}>
              <RefreshCw className={loading ? "spin" : ""} size={17} />
              {loading ? "Refreshing" : "Refresh"}
            </button>
          </div>
        </div>

        {error && <div className="notice bad">{error}</div>}

        <div className={`dashboard-readiness ${readiness.tone}`}>
          <span className="dashboard-readiness-icon" aria-hidden="true">
            <ReadinessIcon size={24} />
          </span>
          <div className="dashboard-readiness-copy">
            <span>{readiness.eyebrow}</span>
            <strong>{readiness.title}</strong>
            <p>{readiness.description}</p>
            {latest && (
              <div className="dashboard-run-meta">
                <span>Run #{latest.id}</span>
                <span>{formatStatus(latest.solver_status ?? latest.status)}</span>
                <span>{formatDate(latest.created_at)}</span>
              </div>
            )}
          </div>
          <div className="dashboard-readiness-actions">
            <a className="button" href={readiness.href}>
              {readiness.action}
              <ArrowRight size={17} />
            </a>
            {readiness.exportReady && latest && (
              <a className="button secondary" href={exportUrl(latest.id, "xlsx")}>
                <FileSpreadsheet size={17} />
                Download XLSX
              </a>
            )}
          </div>
        </div>

        <div className="metric-grid dashboard-health-grid">
          {kpis.map((item) => {
            const Icon = item.icon;
            return (
              <article className="metric-card dashboard-kpi-card" key={item.label}>
                <div className="dashboard-kpi-top">
                  <div className={`metric-icon ${item.tone}`}>
                    <Icon size={20} />
                  </div>
                  {item.badge}
                </div>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <p>{item.detail}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="dashboard-command-grid">
        <article className="status-card dashboard-issues-card">
          <div className="section-heading">
            <div>
              <div className="status-card-title">Attention Needed</div>
              <p>Highest-impact input and schedule issues, ordered by frequency</p>
            </div>
            <a className="button secondary slim" href={dashboard.validation.error_count > 0 ? "#upload" : "#review"}>
              Open {dashboard.validation.error_count > 0 ? "input" : "review"}
              <ArrowRight size={15} />
            </a>
          </div>

          {insights && insights.top_issues.length > 0 ? (
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
                </div>
              ))}
            </div>
          ) : (
            <div className="dashboard-clear-state">
              <CheckCircle2 size={24} />
              <div>
                <strong>No current issues</strong>
                <p>Input validation and the latest schedule are clear.</p>
              </div>
            </div>
          )}
        </article>

        <article className="status-card dashboard-quality-card">
          <div className="section-heading">
            <div>
              <div className="status-card-title">Schedule Quality</div>
              <p>What contributes to the current score</p>
            </div>
            {quality && <OptimisedScoreInfo quality={quality} />}
          </div>

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
      </section>
    </div>
  );
}

function QualityFact({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function dashboardReadiness(dashboard: Dashboard) {
  const latest = dashboard.latest_schedule;
  if (latest && latest.hard_violation_count > 0) {
    return {
      tone: "bad",
      icon: AlertTriangle,
      eyebrow: "Review required",
      title: `${latest.hard_violation_count} hard conflict${latest.hard_violation_count === 1 ? "" : "s"} block export`,
      description: "Review the affected sessions and apply a valid timetable adjustment.",
      action: "Review conflicts",
      href: "#review",
      exportReady: false,
    };
  }
  if (latest) {
    const hasInputErrors = dashboard.validation.error_count > 0;
    return {
      tone: hasInputErrors ? "warn" : "good",
      icon: CheckCircle2,
      eyebrow: "Current schedule",
      title: "Timetable is ready for export",
      description: hasInputErrors
        ? `No hard conflicts remain. Correct ${dashboard.validation.error_count} input issue${dashboard.validation.error_count === 1 ? "" : "s"} before the next generation.`
        : (latest.quality?.summary ?? "No hard conflicts remain in the latest schedule."),
      action: "Open export options",
      href: "#export",
      exportReady: true,
    };
  }
  if (dashboard.validation.error_count > 0) {
    return {
      tone: "bad",
      icon: ShieldAlert,
      eyebrow: "Input readiness",
      title: `${dashboard.validation.error_count} validation issue${dashboard.validation.error_count === 1 ? "" : "s"} require attention`,
      description: "Correct invalid or incomplete inputs before generating the first timetable.",
      action: "Review input data",
      href: "#upload",
      exportReady: false,
    };
  }
  return {
    tone: "info",
    icon: CalendarDays,
    eyebrow: "Ready for generation",
    title: "Inputs are ready for the solver",
    description: "Generate the first timetable to evaluate coverage, conflicts, and quality.",
    action: "Generate timetable",
    href: "#soft-constraints",
    exportReady: false,
  };
}

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
}
