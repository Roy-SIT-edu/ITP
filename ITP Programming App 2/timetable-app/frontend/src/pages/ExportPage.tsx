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
          <h1>Export</h1>
          <p>Generated timetable files</p>
        </div>
        <button className="button secondary" onClick={load}>
          <RefreshCw size={17} />
          Refresh
        </button>
      </div>
      {error && <div className="notice bad">{error}</div>}
      {schedule && (
        <>
          <div className="status-row">
            <StatusBadge label={`Run ${schedule.schedule_run.id}`} tone="info" />
            <span>{schedule.scheduled_sessions.length} scheduled sessions</span>
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
        </>
      )}
    </div>
  );
}
