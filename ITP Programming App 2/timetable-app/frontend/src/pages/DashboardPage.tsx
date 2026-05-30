/*
 * Dashboard page.
 * Shows current import/validation/generation metrics; the flow chart lives in the global layout.
 */

import { Info, RefreshCw } from "lucide-react";
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
  return (
    <div className="page">
      <div className="page-header">
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

      <section className="metric-grid">
        <div className="metric-card">
          <span>Total sessions</span>
          <strong>{dashboard.total_sessions}</strong>
        </div>
        <div className="metric-card">
          <span>Imported rows</span>
          <strong>{dashboard.imported_rows}</strong>
        </div>
        <div className="metric-card">
          <span>Validation</span>
          <strong>{dashboard.validation.error_count}</strong>
          <span title={"Input validation checks uploaded session data for missing or invalid fields. Schedule issues are constraint violations detected after generating a timetable (conflicts in scheduled sessions)."} style={{ marginLeft: 8 }}>
            <Info size={14} />
          </span>
          <StatusBadge
            label={dashboard.validation.is_valid ? "Valid" : "Needs fixes"}
            tone={dashboard.validation.is_valid ? "good" : "bad"}
          />
        </div>
        <div className="metric-card">
          <span>Schedule</span>
          <strong>{latest?.solver_status ?? "None"}</strong>
          <StatusBadge label={latest?.status ?? "No run"} tone={latest ? "info" : "neutral"} />
        </div>
        <div className="metric-card">
          <span>Hard conflicts</span>
          <strong>{latest?.hard_violation_count ?? 0}</strong>
        </div>
        <div className="metric-card">
          <span>Soft score</span>
          <strong>{latest?.soft_score ?? 0}</strong>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="status-card">
          <div className="section-heading">
            <div>
              <div className="status-card-title">Smart Constraint Dashboard</div>
              <p>Highest priority validation and schedule issues</p>
            </div>
          </div>
          {insights && insights.top_issues.length > 0 ? (
            <div className="issue-stack">
              {insights.top_issues.slice(0, 6).map((issue) => (
                <div className="issue-pill" key={issue.code}>
                  <span>{issue.code.split("_").join(" ")}</span>
                  <strong>{issue.count}</strong>
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
      {items.slice(0, 8).map((item) => (
        <AvailabilityRow days={days} item={item} key={item.label} />
      ))}
      {items.length > 8 && <span className="muted">Showing 8 of {items.length}</span>}
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
      <span className="availability-name" title={item.label}>{item.label}</span>
      {days.map(([day]) => (
        <small className={counts[day] ? "busy" : ""} key={day} title={`${day}: ${counts[day] ?? 0}`}>
          {counts[day] ?? 0}
        </small>
      ))}
    </div>
  );
}
