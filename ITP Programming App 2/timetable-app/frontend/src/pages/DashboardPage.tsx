/*
 * Dashboard page.
 * Shows current import/validation/generation metrics; the flow chart lives in the global layout.
 */

import { Info, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { getDashboard } from "../api/client";
import type { Dashboard } from "../types";
import StatusBadge from "../components/StatusBadge";

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    getDashboard().then(setDashboard).catch((err: Error) => setError(err.message));
  };

  useEffect(load, []);

  if (error) return <div className="notice bad">{error}</div>;
  if (!dashboard) return <div className="empty-state">Loading dashboard.</div>;

  const latest = dashboard.latest_schedule;
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Academic timetable scheduling</p>
        </div>
        <button className="button secondary" onClick={load}>
          <RefreshCw size={17} />
          Refresh
        </button>
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
    </div>
  );
}
