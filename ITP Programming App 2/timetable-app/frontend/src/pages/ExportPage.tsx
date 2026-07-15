/*
 * Export page.
 * Provides CSV/XLSX links for the latest generated schedule.
 */

import { Download, FileSpreadsheet, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
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
      {schedule && <ExportCard schedule={schedule} />}
    </div>
  );
}

function ExportCard({ schedule }: { schedule: ScheduleResponse }) {
  const hardConflicts = schedule.schedule_run.hard_violation_count;
  const exportLocked = hardConflicts > 0;
  const gateMessage = exportLocked
    ? "⚠️ You must resolve all Hard Conflicts before you can export your timetable."
    : "🎉 All hard conflicts resolved! Timetable is ready for export.";

  const blockLockedExport = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!exportLocked) return;
    event.preventDefault();
  };

  return (
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
      <div className={`export-gate ${exportLocked ? "locked" : "ready"}`}>{gateMessage}</div>
      <div className="download-row">
        <a
          aria-disabled={exportLocked}
          className={`button ${exportLocked ? "export-disabled" : ""}`}
          href={exportLocked ? undefined : exportUrl(schedule.schedule_run.id, "csv")}
          onClick={blockLockedExport}
          tabIndex={exportLocked ? -1 : undefined}
        >
          <Download size={18} />
          CSV
        </a>
        <a
          aria-disabled={exportLocked}
          className={`button secondary ${exportLocked ? "export-disabled" : ""}`}
          href={exportLocked ? undefined : exportUrl(schedule.schedule_run.id, "xlsx")}
          onClick={blockLockedExport}
          tabIndex={exportLocked ? -1 : undefined}
        >
          <FileSpreadsheet size={18} />
          XLSX
        </a>
      </div>
    </section>
  );
}
