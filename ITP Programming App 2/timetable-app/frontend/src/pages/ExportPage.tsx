/*
 * Export page.
 * Provides CSV/XLSX links for the latest generated schedule.
 */

import { Download, FileSpreadsheet, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { exportUrl, getLatestSchedule } from "../api/client";
import InlineActivity from "../components/InlineActivity";
import StatusBadge from "../components/StatusBadge";
import type { ScheduleResponse } from "../types";

export default function ExportPage() {
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setError(null);
    setLoading(true);
    getLatestSchedule()
      .then(setSchedule)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Export Timetable</h1>
          <p>Download generated timetable files</p>
        </div>
        <div className="toolbar-row">
          <button className="button secondary" onClick={load}>
            <RefreshCw className={loading ? "spin" : ""} size={17} />
            Refresh
          </button>
        </div>
      </div>
      {error && <div className="notice bad">{error}</div>}
      {loading && (
        <InlineActivity
          kind="export"
          title="Preparing export options"
          steps={["Loading latest schedule", "Checking available formats", "Preparing download links"]}
        />
      )}
      {schedule && (
        <section className="status-card export-card">
          <div className="section-heading">
            <div>
              <div className="status-card-title">Latest Schedule</div>
              <p>Download the current generated timetable</p>
            </div>
            <div className="status-row compact">
              <StatusBadge label={`Run ${schedule.schedule_run.id}`} tone="info" />
              <span>{schedule.scheduled_sessions.length} scheduled sessions</span>
            </div>
          </div>
          <div className="download-row">
            <a
              className="button"
              href={exportUrl(schedule.schedule_run.id, "csv")}
              onClick={(e) => {
                if (schedule.schedule_run.hard_violation_count > 0) {
                  if (!window.confirm(`Warning: Your schedule still has ${schedule.schedule_run.hard_violation_count} hard conflicts. Are you sure you want to export it?`)) {
                    e.preventDefault();
                  }
                }
              }}
            >
              <Download size={18} />
              CSV
            </a>
            <a
              className="button secondary"
              href={exportUrl(schedule.schedule_run.id, "xlsx")}
              onClick={(e) => {
                if (schedule.schedule_run.hard_violation_count > 0) {
                  if (!window.confirm(`Warning: Your schedule still has ${schedule.schedule_run.hard_violation_count} hard conflicts. Are you sure you want to export it?`)) {
                    e.preventDefault();
                  }
                }
              }}
            >
              <FileSpreadsheet size={18} />
              XLSX
            </a>
          </div>
        </section>
      )}
    </div>
  );
}
