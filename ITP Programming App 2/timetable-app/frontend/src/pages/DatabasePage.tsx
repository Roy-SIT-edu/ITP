import { Download, Edit2, Plus, RefreshCw, Save, Search, Trash2, Upload, X } from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createDatabaseRow,
  databaseExampleUrl,
  deleteDatabaseRow,
  getDatabaseRows,
  getDatabaseTypes,
  updateDatabaseRow,
  uploadDatabaseFile,
} from "../api/client";
import type { DatabaseColumn, DatabaseRow, DatabaseTypeInfo, UploadSummary } from "../types";

type Props = {
  dataType: string;
};

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

function buildBlankDraft(columns: DatabaseColumn[]) {
  return Object.fromEntries(columns.filter((column) => !column.read_only).map((column) => [column.key, initialValue(column)]));
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const config = types.find((item) => item.id === dataType);
  const columns = config?.columns ?? [];
  const editableColumns = columns.filter((column) => !column.read_only);
  const title = config?.label ?? fallbackLabels[dataType] ?? "Database";

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [typeData, rowData] = await Promise.all([types.length ? Promise.resolve(types) : getDatabaseTypes(), getDatabaseRows(dataType)]);
      setTypes(typeData);
      setRows(rowData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load database rows");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setEditingId(null);
    setAdding(false);
    setDraft({});
    setNewDraft({});
    setSearch("");
    setUploadSummary(null);
    setSuccess(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataType]);

  useEffect(() => {
    if (config && adding && Object.keys(newDraft).length === 0) {
      setNewDraft(buildBlankDraft(config.columns));
    }
  }, [adding, config, newDraft]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => columns.some((column) => displayValue(row[column.key]).toLowerCase().includes(query)));
  }, [columns, rows, search]);

  const beginEdit = (row: DatabaseRow) => {
    setEditingId(row.id);
    setDraft(Object.fromEntries(editableColumns.map((column) => [column.key, row[column.key] ?? initialValue(column)])));
    setAdding(false);
    setError(null);
    setSuccess(null);
  };

  const beginAdd = () => {
    setAdding(true);
    setEditingId(null);
    setNewDraft(buildBlankDraft(columns));
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
        setError(`Upload failed with ${summary.rows_failed} issue${summary.rows_failed === 1 ? "" : "s"}.`);
      } else {
        setSuccess(`Uploaded ${summary.rows_imported} ${title.toLowerCase()} row${summary.rows_imported === 1 ? "" : "s"}.`);
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
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
    return (
      <input
        required={column.required}
        type={column.kind === "number" ? "number" : column.kind === "time" ? "time" : "text"}
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(event) => updateDraft(target, column.key, column.kind === "number" ? event.target.value : event.target.value)}
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
          <a className="button secondary" href={databaseExampleUrl(dataType)}>
            <Download size={17} />
            Example
          </a>
          <button className="button secondary" onClick={() => fileInputRef.current?.click()} disabled={busy}>
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

      {error && <div className="notice bad">{error}</div>}
      {success && <div className="notice good">{success}</div>}
      {uploadSummary && uploadSummary.errors.length > 0 && (
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
      )}

      <div className="filter-bar database-filter">
        <Search size={18} />
        <input placeholder={`Search ${title.toLowerCase()}...`} value={search} onChange={(event) => setSearch(event.target.value)} />
        <span className="muted">{filteredRows.length} rows</span>
      </div>

      <div className="table-wrap database-table">
        <table>
          <thead>
            <tr>
              <th className="action-col">Actions</th>
              {columns.map((column) => (
                <th key={column.key}>{column.label}</th>
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
                    <button className="button secondary slim" title="Cancel" type="button" onClick={() => setAdding(false)}>
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
                        <button className="button secondary slim" title="Cancel" type="button" onClick={() => setEditingId(null)}>
                          <X size={14} />
                        </button>
                      </form>
                    ) : (
                      <div className="row-actions">
                        <button className="button secondary slim" title="Edit" type="button" onClick={() => beginEdit(row)}>
                          <Edit2 size={14} />
                        </button>
                        <button className="button danger slim" title="Delete" type="button" onClick={() => removeRow(row)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                  {columns.map((column) => (
                    <td key={column.key}>
                      {editing && !column.read_only ? fieldInput(column, draft[column.key], "edit") : displayValue(row[column.key])}
                    </td>
                  ))}
                </tr>
              );
            })}
            {!loading && filteredRows.length === 0 && !adding && (
              <tr>
                <td colSpan={columns.length + 1} style={{ textAlign: "center", padding: 24 }}>
                  No rows found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
