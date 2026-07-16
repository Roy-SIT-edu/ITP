import { CheckCircle2, ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ImportPreviewRow, UploadSummary, ValidationIssue } from "../types";

const DEFAULT_COLUMNS = [
  "Requirement ID",
  "Programme",
  "Year",
  "Module Code",
  "Class Type",
  "Delivery Mode",
  "Venue Type Required",
  "Exact Class Size",
  "Staff 1 ID",
  "Fixed Day",
  "Fixed Start Time",
  "Fixed End Time",
];

type Props = {
  applying: boolean;
  summary: UploadSummary;
  onApply: (rows: ImportPreviewRow[]) => Promise<void>;
};

export default function ImportPreviewGrid({ applying, summary, onApply }: Props) {
  const sourceRows = useMemo(() => summary.preview_rows ?? [], [summary.preview_rows]);
  const [draftRows, setDraftRows] = useState<ImportPreviewRow[]>(sourceRows);
  const [query, setQuery] = useState("");
  const [issuesOnly, setIssuesOnly] = useState(summary.rows_failed > 0);
  const [showAllColumns, setShowAllColumns] = useState(false);
  const [expanded, setExpanded] = useState(summary.rows_failed > 0);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraftRows(sourceRows);
    setDirty(false);
    setIssuesOnly(summary.rows_failed > 0);
    setExpanded(summary.rows_failed > 0);
  }, [sourceRows, summary.rows_failed]);

  const issuesByRow = useMemo(() => groupIssuesByRow(summary.errors), [summary.errors]);
  const issueFields = useMemo(() => Array.from(new Set(summary.errors.map((issue) => issue.field))), [summary.errors]);
  const allColumns = useMemo(() => collectColumns(draftRows), [draftRows]);
  const visibleColumns = useMemo(() => {
    if (showAllColumns) return allColumns;
    const defaults = DEFAULT_COLUMNS.filter((column) => allColumns.includes(column));
    const issueColumns = issueFields.filter((field) => allColumns.includes(field) && !defaults.includes(field));
    return [...defaults, ...issueColumns];
  }, [allColumns, issueFields, showAllColumns]);

  const filteredRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return draftRows.filter((row) => {
      const rowIssues = issuesForRow(issuesByRow, row);
      if (issuesOnly && rowIssues.length === 0) return false;
      if (!search) return true;
      return [
        row.source_file,
        String(row.source_row_no),
        ...Object.values(row.values).map((value) => String(value ?? "")),
      ]
        .join(" ")
        .toLowerCase()
        .includes(search);
    });
  }, [draftRows, issuesByRow, issuesOnly, query]);

  if (sourceRows.length === 0) return null;

  const updateCell = (rowId: string, column: string, value: string) => {
    setDraftRows((rows) =>
      rows.map((row) =>
        row.row_id === rowId
          ? {
              ...row,
              values: {
                ...row.values,
                [column]: value.trim() === "" ? null : value,
              },
            }
          : row,
      ),
    );
    setDirty(true);
  };

  return (
    <details
      className="status-card import-preview-card"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="preference-summary">
        <div>
          <div className="status-card-title">Imported Data Preview</div>
          <p>
            {sourceRows.length} row{sourceRows.length === 1 ? "" : "s"} available for in-app review and edits
          </p>
        </div>
        <div className="preference-summary-meta">
          {summary.rows_failed > 0 && (
            <span className="preference-warning">
              {summary.rows_failed} issue{summary.rows_failed === 1 ? "" : "s"}
            </span>
          )}
          <span className="preference-toggle">
            View
            <ChevronDown size={16} />
          </span>
        </div>
      </summary>

      <div className="import-preview-content">
        <div className="import-preview-toolbar">
          <label className="preference-search">
            <Search size={16} />
            <input placeholder="Search rows..." value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <div className="import-preview-actions">
            <label className="toggle-control">
              <input
                checked={issuesOnly}
                disabled={summary.errors.length === 0}
                type="checkbox"
                onChange={(event) => setIssuesOnly(event.target.checked)}
              />
              Issues only
            </label>
            <label className="toggle-control">
              <input
                checked={showAllColumns}
                type="checkbox"
                onChange={(event) => setShowAllColumns(event.target.checked)}
              />
              All columns
            </label>
            <button className="button" disabled={!dirty || applying} type="button" onClick={() => onApply(draftRows)}>
              <CheckCircle2 size={17} />
              {applying ? "Validating" : "Validate & Apply Edits"}
            </button>
          </div>
        </div>

        <div className="import-preview-shell">
          <table className="import-preview-table">
            <thead>
              <tr>
                <th>Row</th>
                {visibleColumns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const rowIssues = issuesForRow(issuesByRow, row);
                return (
                  <tr className={rowIssues.length > 0 ? "has-issue" : ""} key={row.row_id}>
                    <td className="row-meta-cell">
                      <strong>{row.source_row_no}</strong>
                      <span>{row.source_file}</span>
                    </td>
                    {visibleColumns.map((column) => {
                      const cellIssues = issuesForCell(rowIssues, column);
                      return (
                        <td className={cellIssues.length > 0 ? "issue-cell" : ""} key={`${row.row_id}-${column}`}>
                          <input
                            aria-label={`${column} row ${row.source_row_no}`}
                            title={cellIssues.map((issue) => issue.message).join("\n")}
                            value={String(row.values[column] ?? "")}
                            onChange={(event) => updateCell(row.row_id, column, event.target.value)}
                          />
                          {cellIssues.length > 0 && <small>{cellIssues[0].message}</small>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredRows.length === 0 && <div className="empty-state">No rows match the current preview filter.</div>}
        </div>
      </div>
    </details>
  );
}

function collectColumns(rows: ImportPreviewRow[]) {
  const columns = new Set<string>();
  rows.forEach((row) => Object.keys(row.values).forEach((column) => columns.add(column)));
  const defaults = DEFAULT_COLUMNS.filter((column) => columns.has(column));
  const extras = Array.from(columns).filter((column) => !defaults.includes(column));
  return [...defaults, ...extras];
}

function groupIssuesByRow(issues: ValidationIssue[]) {
  const groups = new Map<string, ValidationIssue[]>();
  issues.forEach((issue) => {
    const key = issueKey(issue.source_file ?? null, issue.row);
    groups.set(key, [...(groups.get(key) ?? []), issue]);
  });
  return groups;
}

function issuesForRow(groups: Map<string, ValidationIssue[]>, row: ImportPreviewRow) {
  return (
    groups.get(issueKey(row.source_file, row.source_row_no)) ?? groups.get(issueKey(null, row.source_row_no)) ?? []
  );
}

function issuesForCell(issues: ValidationIssue[], column: string) {
  const columnKey = normalizeField(column);
  return issues.filter((issue) => {
    const fieldKey = normalizeField(issue.field);
    return fieldKey === columnKey || (fieldKey === "duration" && columnKey.startsWith("duration"));
  });
}

function issueKey(sourceFile: string | null, row: number) {
  return `${sourceFile ?? ""}:${row}`;
}

function normalizeField(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
