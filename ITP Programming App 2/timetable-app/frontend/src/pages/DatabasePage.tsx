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
import { ChangeEvent, FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type RecordsTableOptions = {
  className?: string;
  emptyText?: string;
  showNewRow?: boolean;
};

const hiddenLabEditColumns = new Set(["requirement_id", "is_active", "source_sheet", "source_row_no", "raw_programme"]);

const fallbackLabels: Record<string, string> = {
  rooms: "Rooms",
  staff: "Staff",
  programmes: "Programmes",
  modules: "Modules",
  "student-groups": "Student Groups",
  "lab-requirements": "Lab Requirements",
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

function textValue(row: DatabaseRow, key: string) {
  const value = row[key];
  if (value === null || value === undefined || typeof value === "boolean") return "";
  return String(value).trim();
}

function listFromSet(values: Set<string>) {
  return [...values].sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));
}

function labProgramme(row: DatabaseRow) {
  return textValue(row, "programme") || textValue(row, "raw_programme") || textValue(row, "source_sheet") || "Unassigned";
}

function labVenue(row: DatabaseRow) {
  return textValue(row, "location") || textValue(row, "required_room_codes") || "Unassigned venue";
}

function splitDisplayValues(value: string) {
  return value
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function CompactValueList({ fullText, label, values }: { fullText: string; label: string; values: string[] }) {
  const [open, setOpen] = useState(false);
  const preview = values[0];
  const remaining = values.length - 1;

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="database-value-trigger"
        onClick={() => setOpen(true)}
        title={`View all ${values.length} ${label.toLowerCase()}`}
        type="button"
      >
        <span className="database-value-preview">{preview}</span>
        <span className="database-value-count">+{remaining}</span>
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)} role="presentation">
          <section
            aria-label={`${label} for this record`}
            aria-modal="true"
            className="modal-content database-value-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="modal-header">
              <div>
                <h2>{label}</h2>
                <span className="muted">{values.length} values</span>
              </div>
              <button
                aria-label={`Close ${label.toLowerCase()}`}
                className="button secondary slim"
                onClick={() => setOpen(false)}
                type="button"
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body database-value-modal-body">
              <span className="database-value-list" role="list">
                {values.map((item, index) => (
                  <span key={`${item}-${index}`} role="listitem">
                    {item}
                  </span>
                ))}
              </span>
            </div>
            <div className="modal-footer">
              <button className="button secondary" onClick={() => setOpen(false)} type="button">
                Close
              </button>
            </div>
          </section>
        </div>
      )}
      <span className="sr-only">{fullText}</span>
    </>
  );
}

function ListCell({ empty = "-", label, value }: { empty?: string; label: string; value: string }) {
  const values = splitDisplayValues(value);
  if (values.length === 0) return <span>{empty}</span>;
  if (values.length > 4) return <CompactValueList fullText={value} label={label} values={values} />;
  return (
    <span className="lab-cell-list">
      {values.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </span>
  );
}

function DatabaseCellValue({ label, value }: { label: string; value: DatabaseRow[string] }) {
  const text = displayValue(value);
  if (!text) return <span className="database-cell-empty">-</span>;

  const values = splitDisplayValues(text);
  if (values.length > 4) return <CompactValueList fullText={text} label={label} values={values} />;

  return (
    <span className="database-cell-text" title={text}>
      {text}
    </span>
  );
}

function LabUsageOverview({
  rows,
  adding,
  renderLabRecords,
}: {
  rows: DatabaseRow[];
  adding: boolean;
  renderLabRecords: (tableRows: DatabaseRow[], options?: RecordsTableOptions) => ReactNode;
}) {
  const [selectedProgramme, setSelectedProgramme] = useState("all");
  const programmeOptions = useMemo(() => listFromSet(new Set(rows.map(labProgramme))), [rows]);
  const programmeRows = useMemo(
    () => (selectedProgramme === "all" ? rows : rows.filter((row) => labProgramme(row) === selectedProgramme)),
    [rows, selectedProgramme],
  );
  const groupedRows = useMemo(() => {
    const grouped = new Map<string, DatabaseRow[]>();
    programmeRows.forEach((row) => {
      const programme = labProgramme(row);
      grouped.set(programme, [...(grouped.get(programme) ?? []), row]);
    });
    return [...grouped.entries()].sort((left, right) =>
      left[0].localeCompare(right[0], undefined, { numeric: true, sensitivity: "base" }),
    );
  }, [programmeRows]);

  useEffect(() => {
    if (selectedProgramme !== "all" && !programmeOptions.includes(selectedProgramme)) {
      setSelectedProgramme("all");
    }
  }, [programmeOptions, selectedProgramme]);

  return (
    <div className="lab-usage-overview">
      <div className="lab-usage-header">
        <div>
          <div className="status-card-title">Lab Requirement Records</div>
          <p>
            {programmeRows.length} record{programmeRows.length === 1 ? "" : "s"} grouped by programme
          </p>
        </div>
        <div className="lab-usage-total">{selectedProgramme === "all" ? "All programmes" : selectedProgramme}</div>
      </div>
      <div className="lab-filter-panel">
        <label>
          <span>Programme</span>
          <select value={selectedProgramme} onChange={(event) => setSelectedProgramme(event.target.value)}>
            <option value="all">All programmes</option>
            {programmeOptions.map((programme) => (
              <option key={programme} value={programme}>
                {programme}
              </option>
            ))}
          </select>
        </label>
      </div>
      {programmeRows.length > 0 ? (
        <>
          {adding && (
            <div className="lab-new-record-panel">
              <div className="lab-records-heading">
                <strong>New Lab Requirement Row</strong>
                <span>Fill the row, then save it into the database.</span>
              </div>
              {renderLabRecords([], { showNewRow: true })}
            </div>
          )}
          <div className="lab-programme-group-list">
            {groupedRows.map(([programme, records]) => (
              <section className="lab-record-programme-group" key={programme}>
                <div className="lab-records-heading">
                  <strong>{programme}</strong>
                  <span>
                    {records.length} row{records.length === 1 ? "" : "s"}
                  </span>
                </div>
                {renderLabRecords(records, { emptyText: "No editable records found for this programme." })}
              </section>
            ))}
          </div>
        </>
      ) : (
        <div className="empty-state">No lab requirement records match the selected programme.</div>
      )}
    </div>
  );
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

  const renderRecordsTable = (tableRows: DatabaseRow[], options: RecordsTableOptions = {}) => {
    const showNewRow = Boolean(options.showNewRow);
    return (
      <div className={["table-wrap database-table", options.className].filter(Boolean).join(" ")}>
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
            {showNewRow && (
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
            {tableRows.map((row) => {
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
                      {editing && !column.read_only ? (
                        fieldInput(column, draft[column.key], "edit")
                      ) : (
                        <DatabaseCellValue label={column.label} value={row[column.key]} />
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
            {!loading && tableRows.length === 0 && !showNewRow && (
              <tr>
                <td className="table-empty-cell" colSpan={columns.length + 1}>
                  {options.emptyText ?? "No rows found."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  const renderLabEditForm = (target: "edit" | "new") => {
    const values = target === "edit" ? draft : newDraft;
    const labEditableColumns = editableColumns.filter((column) => !hiddenLabEditColumns.has(column.key));
    return (
      <div className="lab-edit-grid">
        {labEditableColumns.map((column) => (
          <label key={column.key}>
            <span>{column.label}</span>
            {fieldInput(column, values[column.key], target)}
          </label>
        ))}
      </div>
    );
  };

  const renderLabRecords = (tableRows: DatabaseRow[], options: RecordsTableOptions = {}) => {
    const showNewRow = Boolean(options.showNewRow);
    return (
      <div className="table-wrap lab-simple-records-table">
        <table>
          <thead>
            <tr>
              <th>Actions</th>
              <th>ID</th>
              <th>Programme</th>
              <th>Year</th>
              <th>Module</th>
              <th>Student Groups</th>
              <th>Size</th>
              <th>Day</th>
              <th>Time</th>
              <th>Weeks</th>
              <th>Venue Name</th>
              <th>Venue Address</th>
              <th>Staff</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {showNewRow && (
              <tr>
                <td colSpan={14}>
                  <form className="lab-inline-edit-form" onSubmit={saveNew}>
                    <div className="lab-inline-edit-header">
                      <strong>New lab requirement</strong>
                      <div className="row-actions">
                        <button className="button slim" disabled={busy} title="Save" type="submit">
                          <Save size={14} />
                        </button>
                        <button className="button secondary slim" title="Cancel" type="button" onClick={() => setAdding(false)}>
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                    {renderLabEditForm("new")}
                  </form>
                </td>
              </tr>
            )}
            {tableRows.map((row) => {
              const editing = editingId === row.id;
              if (editing) {
                return (
                  <tr key={row.id}>
                    <td colSpan={14}>
                      <form className="lab-inline-edit-form" onSubmit={saveEdit}>
                        <div className="lab-inline-edit-header">
                          <strong>Lab row {row.id}</strong>
                          <div className="row-actions">
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
                          </div>
                        </div>
                        {renderLabEditForm("edit")}
                      </form>
                    </td>
                  </tr>
                );
              }

              const start = textValue(row, "fixed_start_time");
              const end = textValue(row, "fixed_end_time");
              const time = start && end ? `${start}-${end}` : start || end || "-";
              const weeks = textValue(row, "custom_weeks") || textValue(row, "week_pattern");

              return (
                <tr key={row.id}>
                  <td>
                    <div className="row-actions">
                      <button className="button secondary slim" title="Edit" type="button" onClick={() => beginEdit(row)}>
                        <Edit2 size={14} />
                      </button>
                      <button className="button danger slim" title="Delete" type="button" onClick={() => removeRow(row)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                  <td>{displayValue(row.id)}</td>
                  <td>{textValue(row, "programme") || "-"}</td>
                  <td>{displayValue(row.year) || "-"}</td>
                  <td>{textValue(row, "module_code") || "-"}</td>
                  <td>
                    <ListCell
                      label="Student groups"
                      value={textValue(row, "student_group_codes") || textValue(row, "student_group")}
                    />
                  </td>
                  <td>{displayValue(row.group_size) || "-"}</td>
                  <td>{textValue(row, "fixed_day") || "-"}</td>
                  <td>
                    <strong>{time}</strong>
                  </td>
                  <td>{weeks ? `W${weeks}` : "-"}</td>
                  <td>
                    <strong>{labVenue(row)}</strong>
                  </td>
                  <td>
                    <ListCell label="Venue addresses" value={textValue(row, "required_room_codes")} />
                  </td>
                  <td>
                    <ListCell label="Staff" value={textValue(row, "staff_names")} />
                  </td>
                  <td>{textValue(row, "notes") || textValue(row, "setup_turnaround_note") || "-"}</td>
                </tr>
              );
            })}
            {!loading && tableRows.length === 0 && !showNewRow && (
              <tr>
                <td className="table-empty-cell" colSpan={14}>
                  {options.emptyText ?? "No rows found."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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

        {dataType === "lab-requirements" ? (
          <LabUsageOverview
            adding={adding}
            rows={filteredRows}
            renderLabRecords={renderLabRecords}
          />
        ) : (
          renderRecordsTable(filteredRows, { showNewRow: adding })
        )}
      </section>
    </div>
  );
}
