/*
 * Generic Database tab page.
 * Renders any configured split database type as a searchable, editable table.
 */

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  Edit2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDatabaseRow,
  databaseCurrentInputUrl,
  deleteDatabaseRow,
  getDatabaseRows,
  getDatabaseTypes,
  updateDatabaseRow,
  uploadDatabaseFile,
} from "../api/client";
import DatabaseUploadWarning from "../components/database/DatabaseUploadWarning";
import { notifyWorkflowProgressChange } from "../components/WorkflowProgress";
import type { DatabaseColumn, DatabaseRow, DatabaseTypeInfo, UploadSummary } from "../types";

type Props = {
  dataType: string;
};

type SortState = {
  key: string;
  direction: "asc" | "desc";
} | null;

const fallbackLabels: Record<string, string> = {
  rooms: "Rooms",
  staff: "Staff",
  programmes: "Programmes",
  modules: "Modules",
  "student-groups": "Student Groups",
  "time-slots": "Time Slots",
  requirements: "Requirements",
};

function initialValue(column: DatabaseColumn) {
  if (column.kind === "boolean") return false;
  if (column.kind === "number") return "";
  return "";
}

function displayValue(value: DatabaseRow[string]) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined) return "";
  return String(value);
}

function buildBlankDraft(columns: DatabaseColumn[], dataType?: string) {
  const draft: Record<string, unknown> = Object.fromEntries(
    columns.filter((column) => !column.read_only).map((column) => [column.key, initialValue(column)]),
  );
  if (dataType === "student-groups" && "size" in draft) {
    draft.size = 40;
  }
  return draft;
}

function compareRows(left: DatabaseRow, right: DatabaseRow, column: DatabaseColumn, direction: "asc" | "desc") {
  const modifier = direction === "asc" ? 1 : -1;
  const leftValue = left[column.key];
  const rightValue = right[column.key];

  if (leftValue === null || leftValue === undefined || leftValue === "")
    return rightValue === null || rightValue === undefined || rightValue === "" ? 0 : 1;
  if (rightValue === null || rightValue === undefined || rightValue === "") return -1;

  if (column.kind === "number") {
    return (Number(leftValue) - Number(rightValue)) * modifier;
  }
  if (column.kind === "boolean") {
    return (Number(Boolean(leftValue)) - Number(Boolean(rightValue))) * modifier;
  }
  return (
    String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" }) * modifier
  );
}

export default function DatabasePage({ dataType }: Props) {
  const [types, setTypes] = useState<DatabaseTypeInfo[]>([]);
  const [rows, setRows] = useState<DatabaseRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [adding, setAdding] = useState(false);
  const [newDraft, setNewDraft] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null);
  const [showUploadWarning, setShowUploadWarning] = useState(false);
  const [sort, setSort] = useState<SortState>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const config = useMemo(() => types.find((item) => item.id === dataType), [dataType, types]);
  const columns = useMemo(() => config?.columns ?? [], [config]);
  const editableColumns = useMemo(() => columns.filter((column) => !column.read_only), [columns]);
  const title = config?.label ?? fallbackLabels[dataType] ?? "Database";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [typeData, rowData] = await Promise.all([getDatabaseTypes(), getDatabaseRows(dataType)]);
      setTypes(typeData);
      setRows(rowData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load database rows");
    } finally {
      setLoading(false);
    }
  }, [dataType]);

  useEffect(() => {
    setEditingId(null);
    setAdding(false);
    setDraft({});
    setNewDraft({});
    setSearch("");
    setSort(null);
    setUploadSummary(null);
    setSuccess(null);
    void load();
  }, [dataType, load]);

  useEffect(() => {
    if (config && adding && Object.keys(newDraft).length === 0) {
      setNewDraft(buildBlankDraft(config.columns, dataType));
    }
  }, [adding, config, dataType, newDraft]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = query
      ? rows.filter((row) => columns.some((column) => displayValue(row[column.key]).toLowerCase().includes(query)))
      : rows;
    if (!sort) return matches;
    const column = columns.find((item) => item.key === sort.key);
    if (!column) return matches;
    return [...matches].sort((left, right) => compareRows(left, right, column, sort.direction));
  }, [columns, rows, search, sort]);

  const toggleSort = (column: DatabaseColumn) => {
    setSort((previous) => {
      if (previous?.key !== column.key) return { key: column.key, direction: "asc" };
      if (previous.direction === "asc") return { key: column.key, direction: "desc" };
      return null;
    });
  };

  const beginEdit = (row: DatabaseRow) => {
    setEditingId(row.id);
    setDraft(
      Object.fromEntries(editableColumns.map((column) => [column.key, row[column.key] ?? initialValue(column)])),
    );
    setAdding(false);
    setError(null);
    setSuccess(null);
  };

  const beginAdd = () => {
    setAdding(true);
    setEditingId(null);
    setNewDraft(buildBlankDraft(columns, dataType));
    setError(null);
    setSuccess(null);
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (editingId === null) return;
    setBusy(true);
    setError(null);
    try {
      await updateDatabaseRow(dataType, editingId, draft);
      setSuccess(`${title} row updated.`);
      setEditingId(null);
      await load();
      notifyWorkflowProgressChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const saveNew = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createDatabaseRow(dataType, newDraft);
      setSuccess(`${title} row added.`);
      setAdding(false);
      await load();
      notifyWorkflowProgressChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const removeRow = async (row: DatabaseRow) => {
    if (!window.confirm(`Delete this ${title} row?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteDatabaseRow(dataType, row.id);
      setSuccess(`${title} row deleted.`);
      await load();
      notifyWorkflowProgressChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const uploadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    setUploadSummary(null);
    try {
      const summary = await uploadDatabaseFile(dataType, file);
      setUploadSummary(summary);
      if (summary.rows_failed > 0) {
        // Replace uploads rollback on validation errors, so reload only on success.
        setError(`Upload failed with ${summary.rows_failed} issue${summary.rows_failed === 1 ? "" : "s"}.`);
      } else {
        setSuccess(
          `Uploaded ${summary.rows_imported} ${title.toLowerCase()} row${summary.rows_imported === 1 ? "" : "s"}.`,
        );
        await load();
        notifyWorkflowProgressChange();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  };

  const beginUpload = () => {
    setError(null);
    setSuccess(null);
    setShowUploadWarning(true);
  };

  const continueUpload = () => {
    setShowUploadWarning(false);
    fileInputRef.current?.click();
  };

  const updateDraft = (target: "edit" | "new", key: string, value: unknown) => {
    const setter = target === "edit" ? setDraft : setNewDraft;
    setter((previous) => ({ ...previous, [key]: value }));
  };

  const fieldInput = (column: DatabaseColumn, value: unknown, target: "edit" | "new") => {
    if (column.kind === "boolean") {
      return (
        <input
          checked={Boolean(value)}
          onChange={(event) => updateDraft(target, column.key, event.target.checked)}
          type="checkbox"
        />
      );
    }
    if (column.options?.length) {
      const currentValue = value === null || value === undefined ? "" : String(value);
      const options = column.options.some((option) => option.toLowerCase() === currentValue.toLowerCase())
        ? column.options
        : currentValue
          ? [currentValue, ...column.options]
          : column.options;
      return (
        <select
          required={column.required}
          value={currentValue}
          onChange={(event) => updateDraft(target, column.key, event.target.value)}
        >
          {!column.required && <option value="">Not set</option>}
          {column.required && <option value="">Select {column.label}</option>}
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        max={column.kind === "number" ? column.max_value : undefined}
        maxLength={column.kind === "text" ? column.max_length : undefined}
        min={column.kind === "number" ? column.min_value : undefined}
        required={column.required}
        type={column.kind === "number" ? "number" : column.kind === "time" ? "time" : "text"}
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(event) =>
          updateDraft(target, column.key, column.kind === "number" ? event.target.value : event.target.value)
        }
      />
    );
  };

  return (
    <div className="page database-page">
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          <p>View, upload, edit, append, and delete database records</p>
        </div>
        <div className="toolbar-row">
          <a className="button secondary" href={databaseCurrentInputUrl(dataType)}>
            <Download size={17} />
            Download Current
          </a>
          <button className="button secondary" onClick={beginUpload} disabled={busy}>
            <Upload size={17} />
            Upload Excel
          </button>
          <input ref={fileInputRef} hidden accept=".xlsx,.xls" type="file" onChange={uploadFile} />
          <button className="button secondary" onClick={load} disabled={loading || busy}>
            <RefreshCw className={loading ? "spin" : ""} size={17} />
            Refresh
          </button>
          <button className="button" onClick={beginAdd} disabled={busy || !config}>
            <Plus size={17} />
            Add Row
          </button>
        </div>
      </div>

      {showUploadWarning && (
        <DatabaseUploadWarning
          title={title}
          currentUrl={databaseCurrentInputUrl(dataType)}
          onCancel={() => setShowUploadWarning(false)}
          onContinue={continueUpload}
        />
      )}

      {error && <div className="notice bad">{error}</div>}
      {success && <div className="notice good">{success}</div>}
      {uploadSummary && uploadSummary.errors.length > 0 && (
        <section className="status-card">
          <div className="section-heading">
            <div>
              <div className="status-card-title">Upload Issues</div>
              <p>Fix these rows in the workbook and upload again</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Field</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {uploadSummary.errors.map((item, index) => (
                  <tr key={`${item.row}-${item.field}-${index}`}>
                    <td>{item.row}</td>
                    <td>{item.field}</td>
                    <td>{item.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="status-card data-section">
        <div className="section-heading">
          <div>
            <div className="status-card-title">{title} Records</div>
            <p>
              {filteredRows.length} row{filteredRows.length === 1 ? "" : "s"} shown
            </p>
          </div>
        </div>

        <div className="filter-bar database-filter">
          <Search size={18} />
          <input
            placeholder={`Search ${title.toLowerCase()}...`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <span className="muted">{filteredRows.length} rows</span>
        </div>

        <div className="table-wrap database-table">
          <table>
            <thead>
              <tr>
                <th className="action-col">Actions</th>
                {columns.map((column) => (
                  <th key={column.key}>
                    <button
                      aria-label={`Sort by ${column.label}`}
                      aria-pressed={sort?.key === column.key}
                      className="table-sort-button"
                      onClick={() => toggleSort(column)}
                      type="button"
                    >
                      <span>{column.label}</span>
                      {sort?.key === column.key ? (
                        sort.direction === "asc" ? (
                          <ArrowUp size={13} />
                        ) : (
                          <ArrowDown size={13} />
                        )
                      ) : (
                        <ArrowUpDown size={13} />
                      )}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {adding && (
                <tr>
                  <td className="action-cell">
                    <form className="row-actions" id="new-database-row" onSubmit={saveNew}>
                      <button className="button slim" disabled={busy} title="Save" type="submit">
                        <Save size={14} />
                      </button>
                      <button
                        className="button secondary slim"
                        title="Cancel"
                        type="button"
                        onClick={() => setAdding(false)}
                      >
                        <X size={14} />
                      </button>
                    </form>
                  </td>
                  {columns.map((column) => (
                    <td key={column.key}>{column.read_only ? "" : fieldInput(column, newDraft[column.key], "new")}</td>
                  ))}
                </tr>
              )}
              {filteredRows.map((row) => {
                const editing = editingId === row.id;
                return (
                  <tr key={row.id}>
                    <td className="action-cell">
                      {editing ? (
                        <form className="row-actions" onSubmit={saveEdit}>
                          <button className="button slim" disabled={busy} title="Save" type="submit">
                            <Save size={14} />
                          </button>
                          <button
                            className="button secondary slim"
                            title="Cancel"
                            type="button"
                            onClick={() => setEditingId(null)}
                          >
                            <X size={14} />
                          </button>
                        </form>
                      ) : (
                        <div className="row-actions">
                          <button
                            className="button secondary slim"
                            title="Edit"
                            type="button"
                            onClick={() => beginEdit(row)}
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            className="button danger slim"
                            title="Delete"
                            type="button"
                            onClick={() => removeRow(row)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </td>
                    {columns.map((column) => (
                      <td key={column.key}>
                        {editing && !column.read_only
                          ? fieldInput(column, draft[column.key], "edit")
                          : displayValue(row[column.key])}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {!loading && filteredRows.length === 0 && !adding && (
                <tr>
                  <td className="table-empty-cell" colSpan={columns.length + 1}>
                    No rows found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
