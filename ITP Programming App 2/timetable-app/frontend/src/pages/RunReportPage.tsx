import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  FlaskConical,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getScheduleReport, scheduleReportPdfUrl } from "../api/client";
import StatusBadge from "../components/StatusBadge";
import type { ReportBreakdownItem, ReportSession, ReportWorkloadItem, ScheduleReport } from "../types";

type SessionFilter = {
  query: string;
  source: "" | "uploaded" | "lab";
  issues: "" | "clean" | "hard" | "soft";
};

const emptyFilter: SessionFilter = { query: "", source: "", issues: "" };

export default function RunReportPage() {
  const runId = reportRunId();
  const [report, setReport] = useState<ScheduleReport | null>(null);
  const [filter, setFilter] = useState<SessionFilter>(emptyFilter);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!runId) {
      setError("This report link does not contain a valid timetable run.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setReport(await getScheduleReport(runId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the timetable report.");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (report) document.title = `Timetable Run ${report.run.id} Report`;
  }, [report]);

  const visibleSessions = useMemo(
    () => report?.sessions.filter((session) => matchesSessionFilter(session, filter)) ?? [],
    [filter, report],
  );

  if (loading) {
    return (
      <div className="run-report-page report-state-page">
        <RefreshCw className="spin" size={24} />
        <strong>Building timetable run report</strong>
        <span>Collecting scheduling, workload, and conflict information.</span>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="run-report-page report-state-page">
        <AlertTriangle size={26} />
        <strong>Report unavailable</strong>
        <span>{error ?? "No report data was returned."}</span>
        <a className="button secondary" href="#review">
          <ArrowLeft size={16} />
          Return to Review
        </a>
      </div>
    );
  }

  const summary = report.summary;
  const quality = report.quality;
  const runStatus = report.run.solver_status ?? report.run.status;

  return (
    <div className="run-report-page">
      <header className="report-topbar">
        <div className="report-topbar-brand">
          <FileText size={21} />
          <div>
            <strong>Timetable Scheduler</strong>
            <span>Administration report</span>
          </div>
        </div>
        <div className="report-actions">
          <a className="button secondary" href="#review">
            <ArrowLeft size={16} />
            Review Timetable
          </a>
          <a className="button" href={scheduleReportPdfUrl(report.run.id)}>
            <Download size={17} />
            Export PDF
          </a>
        </div>
      </header>

      <main className="report-document">
        <section className="report-title-band">
          <div>
            <span className="report-eyebrow">Timetable run {report.run.id}</span>
            <h1>Scheduling Administration Report</h1>
            <p>
              Generated {formatDateTime(report.report_generated_at)} from the run created{" "}
              {formatDateTime(report.run.created_at)}
            </p>
          </div>
          <div className="report-run-status">
            <StatusBadge label={runStatus} tone={summary.hard_conflict_count > 0 ? "bad" : "good"} />
            <StatusBadge label={`${quality.score}/100 ${quality.label}`} tone={quality.tone} />
          </div>
        </section>

        <section className="report-metric-strip" aria-label="Run summary">
          <ReportMetric icon={CalendarDays} label="Sessions" value={summary.scheduled_count} />
          <ReportMetric icon={FlaskConical} label="Lab requirements" value={summary.lab_session_count} />
          <ReportMetric icon={Clock3} label="Scheduled hours" value={summary.total_scheduled_hours} />
          <ReportMetric icon={Building2} label="Rooms used" value={summary.room_count} />
          <ReportMetric icon={Users} label="Staff assigned" value={summary.staff_count} />
          <ReportMetric
            icon={summary.hard_conflict_count > 0 ? AlertTriangle : CheckCircle2}
            label="Affected sessions"
            value={summary.affected_session_count}
          />
        </section>

        <ReportSection title="Run overview" subtitle="Solver outcome, schedule scope, and optimisation result">
          <div className="report-overview-grid">
            <dl className="report-facts">
              <ReportFact label="Run status" value={report.run.status} />
              <ReportFact label="Solver status" value={runStatus} />
              <ReportFact label="Export ready" value={quality.export_ready ? "Yes" : "No"} />
              <ReportFact label="Programmes" value={summary.programme_count} />
              <ReportFact label="Modules" value={summary.module_count} />
              <ReportFact label="Student groups" value={summary.student_group_count} />
              <ReportFact label="Uploaded sessions" value={summary.uploaded_session_count} />
              <ReportFact label="Final lab sessions" value={summary.lab_session_count} />
              <ReportFact label="Original lab bookings" value={summary.original_lab_session_count} />
              <ReportFact label="Lab overlap pairs" value={summary.lab_overlap_pair_count} />
              <ReportFact label="Labs excluded from final" value={summary.excluded_lab_session_count} />
            </dl>
            <div className="report-score-panel">
              <div className="report-score-heading">
                <div>
                  <span>Optimised score</span>
                  <strong>{quality.score}/100</strong>
                </div>
                <StatusBadge label={quality.label} tone={quality.tone} />
              </div>
              <p>{quality.summary}</p>
              <div className="score-deduction-grid">
                <ScoreDeduction label="Hard conflicts" value={report.quality_breakdown.hard_conflict_deduction} />
                <ScoreDeduction label="Soft warnings" value={report.quality_breakdown.soft_warning_deduction} />
                <ScoreDeduction label="Affected sessions" value={report.quality_breakdown.affected_session_deduction} />
                <ScoreDeduction
                  label="Preference pressure"
                  value={report.quality_breakdown.preference_pressure_deduction}
                />
              </div>
              {report.quality_breakdown.hard_conflict_cap_applied && (
                <div className="report-inline-alert">Hard conflicts cap the final score at 49.</div>
              )}
            </div>
          </div>
        </ReportSection>

        <ReportSection title="Scheduling breakdown" subtitle="Distribution of sessions across the generated timetable">
          <div className="report-breakdown-grid">
            <BreakdownList title="Source" items={report.breakdowns.by_source} />
            <BreakdownList title="Day" items={report.breakdowns.by_day} />
            <BreakdownList title="Class type" items={report.breakdowns.by_class_type} />
            <BreakdownList title="Delivery mode" items={report.breakdowns.by_delivery_mode} />
            <BreakdownList title="Programme" items={report.breakdowns.by_programme} limit={12} />
          </div>
        </ReportSection>

        <ReportSection
          title="Resource workload"
          subtitle="Highest room and staff usage by session count and scheduled hours"
        >
          <div className="report-two-column-tables">
            <WorkloadTable title="Room workload" items={report.breakdowns.room_workload.slice(0, 20)} />
            <WorkloadTable title="Staff workload" items={report.breakdowns.staff_workload.slice(0, 20)} />
          </div>
        </ReportSection>

        <ReportSection
          title="Conflict report"
          subtitle={`${report.conflicts.hard_count} hard conflicts and ${report.conflicts.soft_count} soft warnings recorded`}
        >
          <div className="report-conflict-summary">
            <div className={report.conflicts.hard_count > 0 ? "bad" : "good"}>
              <strong>{report.conflicts.hard_count}</strong>
              <span>Hard conflicts</span>
            </div>
            <div className={report.conflicts.soft_count > 0 ? "warn" : "good"}>
              <strong>{report.conflicts.soft_count}</strong>
              <span>Soft warnings</span>
            </div>
            <div>
              <strong>{report.conflicts.affected_session_count}</strong>
              <span>Affected sessions</span>
            </div>
          </div>

          {report.conflicts.by_constraint.length > 0 ? (
            <>
              <div className="report-table-wrap compact">
                <table>
                  <thead>
                    <tr>
                      <th>Severity</th>
                      <th>Constraint</th>
                      <th>Occurrences</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.conflicts.by_constraint.map((item) => (
                      <tr key={`${item.severity}-${item.constraint_code}`}>
                        <td>
                          <StatusBadge label={item.severity} tone={item.severity === "HARD" ? "bad" : "warn"} />
                        </td>
                        <td>{formatCode(item.constraint_code)}</td>
                        <td>{item.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="report-table-wrap report-conflict-table">
                <table>
                  <thead>
                    <tr>
                      <th>Severity</th>
                      <th>Constraint</th>
                      <th>Message</th>
                      <th>Affected sessions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.conflicts.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <StatusBadge label={item.severity} tone={item.severity === "HARD" ? "bad" : "warn"} />
                        </td>
                        <td>{formatCode(item.constraint_code)}</td>
                        <td>{item.message}</td>
                        <td>
                          {item.affected_sessions.length > 0
                            ? item.affected_sessions
                                .map(
                                  (session) =>
                                    session.module_code ?? session.requirement_id ?? `Session ${session.session_id}`,
                                )
                                .join(", ")
                            : "None recorded"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="report-clean-state">
              <CheckCircle2 size={20} /> No conflicts or warnings were recorded.
            </div>
          )}
        </ReportSection>

        <ReportSection
          title="Fixed lab overlap resolution"
          subtitle={`${report.lab_overlap_resolution.detected_pair_count} original overlap pairs resolved by excluding ${report.lab_overlap_resolution.excluded_session_count} lab sessions from the final timetable`}
        >
          <p className="report-section-note">
            These exclusions apply only to this run&apos;s final timetable and exports. The lab requirements and their
            original run assignments remain in the database for audit and future runs.
          </p>
          {report.lab_overlap_resolution.overlaps.length > 0 ? (
            <div className="report-table-wrap report-conflict-table">
              <table>
                <thead>
                  <tr>
                    <th>Placement</th>
                    <th>Shared resources</th>
                    <th>First lab</th>
                    <th>Second lab</th>
                    <th>Excluded from final</th>
                  </tr>
                </thead>
                <tbody>
                  {report.lab_overlap_resolution.overlaps.map((overlap) => (
                    <tr key={`${overlap.left.session_id}-${overlap.right.session_id}`}>
                      <td>
                        <strong>{overlap.left.day}</strong>
                        <span>
                          {overlap.left.start_time}-{overlap.left.end_time} ({overlap.left.week_pattern})
                        </span>
                      </td>
                      <td>{labOverlapResources(overlap.resources)}</td>
                      <td>{labOverlapSessionLabel(overlap.left)}</td>
                      <td>{labOverlapSessionLabel(overlap.right)}</td>
                      <td>
                        {overlap.excluded_session_ids.length > 0
                          ? [overlap.left, overlap.right]
                              .filter((session) => overlap.excluded_session_ids.includes(session.session_id))
                              .map(
                                (session) =>
                                  session.requirement_id ?? session.module_code ?? `Session ${session.session_id}`,
                              )
                              .join(", ")
                          : "Not resolved in final"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="report-clean-state">
              <CheckCircle2 size={20} /> No fixed lab-to-lab resource overlaps were detected.
            </div>
          )}
        </ReportSection>

        <ReportSection title="Detailed schedule" subtitle="Every scheduled session in this timetable run">
          <div className="report-session-filters">
            <label>
              <span>Search sessions</span>
              <div className="report-search-input">
                <Search size={15} />
                <input
                  type="search"
                  placeholder="Module, requirement, group, staff, or room"
                  value={filter.query}
                  onChange={(event) => setFilter({ ...filter, query: event.target.value })}
                />
              </div>
            </label>
            <label>
              <span>Source</span>
              <select
                value={filter.source}
                onChange={(event) => setFilter({ ...filter, source: event.target.value as SessionFilter["source"] })}
              >
                <option value="">All sources</option>
                <option value="uploaded">Uploaded</option>
                <option value="lab">Lab requirements</option>
              </select>
            </label>
            <label>
              <span>Issue status</span>
              <select
                value={filter.issues}
                onChange={(event) => setFilter({ ...filter, issues: event.target.value as SessionFilter["issues"] })}
              >
                <option value="">All sessions</option>
                <option value="clean">Clean</option>
                <option value="hard">Hard conflicts</option>
                <option value="soft">Soft warnings</option>
              </select>
            </label>
            <button className="button secondary slim" type="button" onClick={() => setFilter(emptyFilter)}>
              Clear
            </button>
            <span className="report-session-count">
              Showing {visibleSessions.length} of {report.sessions.length}
            </span>
          </div>
          <div className="report-table-wrap report-session-table">
            <table>
              <thead>
                <tr>
                  <th>Day / Time</th>
                  <th>Module / Requirement</th>
                  <th>Type / Source</th>
                  <th>Programme / Group</th>
                  <th>Staff</th>
                  <th>Room</th>
                  <th>Weeks</th>
                  <th>Issues</th>
                </tr>
              </thead>
              <tbody>
                {visibleSessions.map((session) => (
                  <tr key={session.scheduled_session_id}>
                    <td>
                      <strong>{session.day}</strong>
                      <span>
                        {session.start_time}-{session.end_time}
                      </span>
                    </td>
                    <td>
                      <strong>{session.module_code ?? "-"}</strong>
                      <span>{session.requirement_id ?? "-"}</span>
                    </td>
                    <td>
                      <strong>{session.class_type ?? "-"}</strong>
                      <span>{session.is_lab_requirement ? "Lab requirement" : "Uploaded"}</span>
                    </td>
                    <td>
                      <strong>{session.programme ?? "-"}</strong>
                      <span>{session.student_group_code ?? "-"}</span>
                    </td>
                    <td>{session.staff_names.join(", ") || "Unassigned"}</td>
                    <td>{session.room ?? "-"}</td>
                    <td>{weekLabel(session)}</td>
                    <td>
                      {session.issue_count === 0 ? (
                        <StatusBadge label="Clean" tone="good" />
                      ) : (
                        <StatusBadge
                          label={`${session.hard_issue_count}H / ${session.soft_issue_count}S`}
                          tone={session.hard_issue_count > 0 ? "bad" : "warn"}
                        />
                      )}
                    </td>
                  </tr>
                ))}
                {visibleSessions.length === 0 && (
                  <tr>
                    <td colSpan={8}>No sessions match the selected report filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </ReportSection>

        <footer className="report-footer">
          <span>Timetable Scheduler Administration Report</span>
          <span>Run {report.run.id}</span>
        </footer>
      </main>
    </div>
  );
}

function ReportSection({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="report-section">
      <div className="report-section-heading">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function ReportMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string | number;
}) {
  return (
    <div>
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReportFact({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ScoreDeduction({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>-{value}</strong>
    </div>
  );
}

function BreakdownList({ title, items, limit }: { title: string; items: ReportBreakdownItem[]; limit?: number }) {
  const visible = limit ? items.slice(0, limit) : items;
  return (
    <div className="report-breakdown-list">
      <h3>{title}</h3>
      {visible.map((item) => (
        <div className="report-breakdown-row" key={item.label}>
          <div>
            <span>{item.label}</span>
            <strong>{item.count}</strong>
          </div>
          <div className="report-breakdown-track">
            <span style={{ width: `${Math.max(item.percent, 1)}%` }} />
          </div>
          <small>{item.percent}%</small>
        </div>
      ))}
      {limit && items.length > limit && (
        <small>{items.length - limit} additional categories are included in the PDF.</small>
      )}
    </div>
  );
}

function WorkloadTable({ title, items }: { title: string; items: ReportWorkloadItem[] }) {
  return (
    <div className="report-workload-table">
      <h3>{title}</h3>
      <div className="report-table-wrap compact">
        <table>
          <thead>
            <tr>
              <th>Resource</th>
              <th>Sessions</th>
              <th>Hours</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.label}>
                <td>{item.label}</td>
                <td>{item.session_count}</td>
                <td>{item.hours}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function reportRunId() {
  const match = window.location.hash.match(/^#run-report\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function formatDateTime(value: string | null) {
  if (!value) return "not available";
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Singapore",
  }).format(date);
}

function formatCode(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function labOverlapResources(resources: ScheduleReport["lab_overlap_resolution"]["overlaps"][number]["resources"]) {
  return [
    resources.rooms.length > 0 ? `Room: ${resources.rooms.join(", ")}` : null,
    resources.staff.length > 0 ? `Staff: ${resources.staff.join(", ")}` : null,
    resources.student_groups.length > 0 ? `Student group: ${resources.student_groups.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("; ");
}

function labOverlapSessionLabel(session: ScheduleReport["lab_overlap_resolution"]["overlaps"][number]["left"]) {
  const identity = session.requirement_id ?? session.module_code ?? `Session ${session.session_id}`;
  const context = [session.programme, session.student_group_code, session.room].filter(Boolean).join(" / ");
  return context ? `${identity} — ${context}` : identity;
}

function weekLabel(session: ReportSession) {
  if (session.custom_weeks) return session.custom_weeks;
  const start = session.start_week ?? 1;
  const end = session.end_week ?? start;
  return `${start}-${end} ${session.week_pattern ?? ""}`.trim();
}

function matchesSessionFilter(session: ReportSession, filter: SessionFilter) {
  if (filter.source === "lab" && !session.is_lab_requirement) return false;
  if (filter.source === "uploaded" && session.is_lab_requirement) return false;
  if (filter.issues === "clean" && session.issue_count > 0) return false;
  if (filter.issues === "hard" && session.hard_issue_count === 0) return false;
  if (filter.issues === "soft" && session.soft_issue_count === 0) return false;
  const terms = filter.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [
    session.module_code,
    session.requirement_id,
    session.student_group_code,
    session.room,
    ...session.staff_names,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}
