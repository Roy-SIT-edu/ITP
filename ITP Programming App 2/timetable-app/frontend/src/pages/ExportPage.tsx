/*
 * Export page.
 * Provides CSV/XLSX links for the latest generated schedule.
 */

import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, RefreshCw, Search, Table2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { exportUrl, getExportPreview, getLatestSchedule } from "../api/client";
import InlineActivity from "../components/InlineActivity";
import StatusBadge from "../components/StatusBadge";
import type { ExportPreview, ScheduleResponse } from "../types";
import { exportPreviewCellLabel, filterExportPreviewRows, paginateExportPreviewRows } from "./exportPreview";

export default function ExportPage() {
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setPreviewError(null);
    setLoading(true);
    try {
      const nextSchedule = await getLatestSchedule();
      setSchedule(nextSchedule);
      try {
        setPreview(await getExportPreview(nextSchedule.schedule_run.id));
      } catch (err) {
        setPreview(null);
        setPreviewError(err instanceof Error ? err.message : "Could not load the export dataframe preview.");
      }
    } catch (err) {
      setSchedule(null);
      setPreview(null);
      setError(err instanceof Error ? err.message : "Could not load the latest schedule.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      {previewError && <div className="notice bad">{previewError}</div>}
      {preview && <ExportDataframePreview preview={preview} />}
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

function ExportDataframePreview({ preview }: { preview: ExportPreview }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const filteredRows = useMemo(() => filterExportPreviewRows(preview.rows, preview.columns, query), [preview, query]);
  const pagination = useMemo(
    () => paginateExportPreviewRows(filteredRows, page, pageSize),
    [filteredRows, page, pageSize],
  );

  const updateQuery = (value: string) => {
    setQuery(value);
    setPage(1);
  };

  const updatePageSize = (value: number) => {
    setPageSize(value);
    setPage(1);
  };

  return (
    <section className="status-card export-dataframe-card">
      <div className="section-heading">
        <div>
          <div className="status-card-title export-dataframe-title">
            <Table2 size={18} />
            Export dataframe preview
          </div>
          <p>Read-only preview of the exact columns and row values used by the CSV and XLSX exports.</p>
        </div>
        <div className="status-row compact">
          <StatusBadge label="Read-only" tone="info" />
          <span>{preview.rows.length} rows</span>
          <span>{preview.columns.length} columns</span>
        </div>
      </div>

      <div className="export-dataframe-toolbar">
        <label className="export-dataframe-search">
          <Search size={16} />
          <input
            aria-label="Search export dataframe"
            onChange={(event) => updateQuery(event.target.value)}
            placeholder="Search all columns"
            type="search"
            value={query}
          />
        </label>
        <label className="export-dataframe-page-size">
          <span>Rows per page</span>
          <select value={pageSize} onChange={(event) => updatePageSize(Number(event.target.value))}>
            {[25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="export-dataframe-wrap">
        <table>
          <thead>
            <tr>
              <th aria-label="Row number">#</th>
              {preview.columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pagination.rows.map((row, rowIndex) => (
              <tr key={`${pagination.startIndex}-${rowIndex}`}>
                <th scope="row">{pagination.startIndex + rowIndex + 1}</th>
                {preview.columns.map((column) => (
                  <td key={column}>{exportPreviewCellLabel(row[column])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {filteredRows.length === 0 && (
          <div className="export-dataframe-empty">
            No export rows match <strong>{query}</strong>.
          </div>
        )}
      </div>

      <div className="export-dataframe-pagination">
        <span>
          Showing {filteredRows.length === 0 ? 0 : pagination.startIndex + 1}-{pagination.endIndex} of{" "}
          {filteredRows.length} rows
          {query && ` (filtered from ${preview.rows.length})`}
        </span>
        <div>
          <button
            aria-label="Previous dataframe page"
            className="button secondary slim"
            disabled={pagination.page <= 1}
            onClick={() => setPage(pagination.page - 1)}
            type="button"
          >
            <ChevronLeft size={16} />
            Previous
          </button>
          <strong>
            Page {pagination.page} of {pagination.pageCount}
          </strong>
          <button
            aria-label="Next dataframe page"
            className="button secondary slim"
            disabled={pagination.page >= pagination.pageCount}
            onClick={() => setPage(pagination.page + 1)}
            type="button"
          >
            Next
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}
