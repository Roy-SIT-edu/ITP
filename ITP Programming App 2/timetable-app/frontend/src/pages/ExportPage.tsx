/*
 * Export page.
 * Provides CSV/XLSX links for the latest generated schedule.
 */

import { Download, FileSpreadsheet, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { exportUrl, getLatestSchedule } from "../api/client";
import StatusBadge from "../components/StatusBadge";
import type { ScheduleResponse } from "../types";

export default function ExportPage() {
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    getLatestSchedule().then(setSchedule).catch((err: Error) => setError(err.message));
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
            <RefreshCw size={17} />
            Refresh
          </button>
        </div>
      </div>
      {error && <div className="notice bad">{error}</div>}
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
            <a className="button" href={exportUrl(schedule.schedule_run.id, "csv")}>
              <Download size={18} />
              CSV
            </a>
            <a className="button secondary" href={exportUrl(schedule.schedule_run.id, "xlsx")}>
              <FileSpreadsheet size={18} />
              XLSX
            </a>
          </div>
        </section>
      )}
    </div>
  );
}
