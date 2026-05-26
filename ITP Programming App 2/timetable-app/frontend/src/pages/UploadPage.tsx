/*
 * Import page and merged requirements editor.
 * Handles multi-file requirements uploads plus manual Add/Edit/Delete in one workflow step.
 */

import { Edit2, Filter, Play, Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  createSession,
  deleteSession,
  generateSchedule,
  getSessions,
  resetRequirementInputs,
  updateSession,
  uploadTemplate,
} from "../api/client";
import { notifyWorkflowProgressChange } from "../components/WorkflowProgress";
import UploadBox from "../components/UploadBox";
import type { SessionRow, UploadSummary } from "../types";

function formatApiError(err: unknown, fallback: string) {
  if (err instanceof ApiError && Array.isArray(err.details)) {
    // Backend validation returns row-level arrays; flatten them for modal notices.
    const messages = err.details
      .map((item) => {
        if (typeof item === "object" && item && "message" in item) {
          const issue = item as { field?: string; message?: string; row?: number };
          const field = issue.field ? `${issue.field}: ` : "";
          const row = issue.row ? `Row ${issue.row} - ` : "";
          return `${row}${field}${issue.message}`;
        }
        return String(item);
      })
      .filter(Boolean);
    if (messages.length > 0) {
      return messages.slice(0, 6).join("\n");
    }
  }
  return err instanceof Error ? err.message : fallback;
}

const emptySession: Omit<SessionRow, "id"> = {
  requirement_id: "",
  programme: "",
  module_code: "",
  student_group_code: "",
  staff_name: "",
  staff_id: "",
  class_type: "Lecture",
  delivery_mode: "Face-to-face",
  campus_mode: "Physical",
  venue_type_required: "classroom",
  duration_minutes: 60,
  sessions_per_week: 1,
  exact_class_size: 40,
  start_week: 1,
  end_week: 13,
  week_pattern: "Weekly",
  custom_weeks: "",
  scheduling_type: "Flexible",
  fixed_day: "",
  fixed_start_time: "",
  fixed_end_time: "",
  preferred_days: "",
  avoid_days: "",
  priority: "Normal",
  remarks: "",
  source_file: "Manual Entry",
  source_row_no: null,
};

type RequirementsEditorProps = {
  refreshSignal: number;
};

function RequirementsEditor({ refreshSignal }: RequirementsEditorProps) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<SessionRow | null>(null);
  const [formData, setFormData] = useState<Omit<SessionRow, "id">>(emptySession);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setSessions(await getSessions());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load requirements");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [refreshSignal]);

  const filteredSessions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter((session) =>
      [
        session.requirement_id,
        session.module_code,
        session.student_group_code,
        session.staff_name,
        session.staff_id,
        session.programme,
      ].some((value) => (value || "").toLowerCase().includes(query)),
    );
  }, [search, sessions]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await generateSchedule();
      setSuccess(
        `Timetable regenerated. Solver status: ${result.solver_status}. Conflicts: ${result.hard_violation_count}.`,
      );
      notifyWorkflowProgressChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleOpenAdd = () => {
    setEditingSession(null);
    setFormData({
      ...emptySession,
      requirement_id: `REQ-${String(sessions.length + 1).padStart(4, "0")}`,
    });
    setError(null);
    setSuccess(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (session: SessionRow) => {
    setEditingSession(session);
    setFormData({
      requirement_id: session.requirement_id || "",
      programme: session.programme || "",
      module_code: session.module_code || "",
      student_group_code: session.student_group_code || "",
      staff_name: session.staff_name || "",
      staff_id: session.staff_id || "",
      class_type: session.class_type || "Lecture",
      delivery_mode: session.delivery_mode || "Face-to-face",
      campus_mode: session.campus_mode || "Physical",
      venue_type_required: session.venue_type_required || "classroom",
      duration_minutes: session.duration_minutes || 60,
      sessions_per_week: session.sessions_per_week || 1,
      exact_class_size: session.exact_class_size || 40,
      start_week: session.start_week || 1,
      end_week: session.end_week || 13,
      week_pattern: session.week_pattern || "Weekly",
      custom_weeks: session.custom_weeks || "",
      scheduling_type: session.scheduling_type || "Flexible",
      fixed_day: session.fixed_day || "",
      fixed_start_time: session.fixed_start_time || "",
      fixed_end_time: session.fixed_end_time || "",
      preferred_days: session.preferred_days || "",
      avoid_days: session.avoid_days || "",
      priority: session.priority || "Normal",
      remarks: session.remarks || "",
      source_file: session.source_file || "Manual Entry",
      source_row_no: session.source_row_no,
    });
    setError(null);
    setSuccess(null);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Delete this requirement?")) return;
    setSaving(true);
    setError(null);
    try {
      await deleteSession(id);
      setSuccess("Requirement deleted.");
      await load();
      notifyWorkflowProgressChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deletion failed");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!formData.staff_name?.trim() && !formData.staff_id?.trim()) {
      setError("Please provide either a staff name or a staff ID.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editingSession) {
        await updateSession(editingSession.id, formData);
        setSuccess("Requirement updated.");
      } else {
        await createSession(formData);
        setSuccess("Requirement added.");
      }
      setIsModalOpen(false);
      await load();
      notifyWorkflowProgressChange();
    } catch (err) {
      setError(formatApiError(err, "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  const updateForm = (key: keyof typeof formData, value: string | number | null) => {
    setFormData((previous) => ({ ...previous, [key]: value }));
  };

  return (
    <section className="requirements-editor">
      <div className="page-header">
        <div>
          <h2>Requirements</h2>
          <p>Review, add, edit, or delete imported teaching requirements</p>
        </div>
        <div className="toolbar-row">
          <button className="button" onClick={handleGenerate} disabled={generating}>
            {generating ? <RefreshCw className="spin" size={17} /> : <Play size={17} />}
            Regenerate
          </button>
          <button className="button secondary" onClick={load} disabled={loading || saving}>
            <RefreshCw className={loading ? "spin" : ""} size={17} />
            Refresh
          </button>
          <button className="button" onClick={handleOpenAdd} disabled={saving}>
            <Plus size={18} />
            Add Requirement
          </button>
        </div>
      </div>

      {error && <div className="notice bad">{error}</div>}
      {success && <div className="notice good">{success}</div>}

      <div className="filter-bar" style={{ justifyContent: "space-between" }}>
        <div className="requirements-search">
          <Filter size={18} />
          <input
            placeholder="Search module, staff, group..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            type="text"
          />
        </div>
        <span className="muted">{filteredSessions.length} requirements</span>
      </div>

      <div className="table-wrap requirements-table">
        <table>
          <thead>
            <tr>
              <th style={{ width: 90 }}>Actions</th>
              <th>Req ID</th>
              <th>Programme</th>
              <th>Module</th>
              <th>Group</th>
              <th>Staff</th>
              <th>Type</th>
              <th>Duration</th>
              <th>Size</th>
              <th>Scheduling</th>
            </tr>
          </thead>
          <tbody>
            {filteredSessions.map((row) => (
              <tr key={row.id}>
                <td>
                  <div className="row-actions">
                    <button className="button secondary slim" title="Edit" type="button" onClick={() => handleOpenEdit(row)}>
                      <Edit2 size={14} />
                    </button>
                    <button className="button danger slim" title="Delete" type="button" onClick={() => handleDelete(row.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
                <td>{row.requirement_id}</td>
                <td>{row.programme}</td>
                <td>{row.module_code}</td>
                <td>{row.student_group_code}</td>
                <td>{row.staff_name || row.staff_id}</td>
                <td>
                  {row.class_type}
                  {row.delivery_mode ? ` (${row.delivery_mode})` : ""}
                </td>
                <td>{row.duration_minutes ? `${row.duration_minutes}m` : ""}</td>
                <td>{row.exact_class_size}</td>
                <td>
                  {row.scheduling_type === "Fixed" ? (
                    <span className="status-badge warn">
                      Fixed: {row.fixed_day} {row.fixed_start_time}
                    </span>
                  ) : (
                    <span className="status-badge good">Flexible</span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && filteredSessions.length === 0 && (
              <tr>
                <td colSpan={10} style={{ padding: 24, textAlign: "center" }}>
                  No requirements found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="modal-backdrop">
          <form className="modal-content" onSubmit={handleSave}>
            <div className="modal-header">
              <h2>{editingSession ? "Edit Requirement" : "Add Requirement"}</h2>
              <button className="button secondary slim" type="button" onClick={() => setIsModalOpen(false)}>
                Close
              </button>
            </div>
            <div className="modal-body">
              <label>
                Requirement ID
                <input required value={formData.requirement_id || ""} onChange={(event) => updateForm("requirement_id", event.target.value)} />
              </label>
              <label>
                Programme
                <input required placeholder="e.g. DSC" value={formData.programme || ""} onChange={(event) => updateForm("programme", event.target.value)} />
              </label>
              <label>
                Module Code
                <input required placeholder="e.g. DSC2204" value={formData.module_code || ""} onChange={(event) => updateForm("module_code", event.target.value)} />
              </label>
              <label>
                Student Group
                <input required placeholder="e.g. DSC-Y2-G1" value={formData.student_group_code || ""} onChange={(event) => updateForm("student_group_code", event.target.value)} />
              </label>
              <label>
                Exact Class Size
                <input
                  required
                  min="1"
                  type="number"
                  value={formData.exact_class_size ?? ""}
                  onChange={(event) => updateForm("exact_class_size", event.target.value ? Number.parseInt(event.target.value, 10) : null)}
                />
              </label>
              <label>
                Staff Name
                <input value={formData.staff_name || ""} onChange={(event) => updateForm("staff_name", event.target.value)} />
              </label>
              <label>
                Staff ID
                <input value={formData.staff_id || ""} onChange={(event) => updateForm("staff_id", event.target.value)} />
              </label>
              <label>
                Class Type
                <select value={formData.class_type || ""} onChange={(event) => updateForm("class_type", event.target.value)}>
                  <option value="Lecture">Lecture</option>
                  <option value="Tutorial">Tutorial</option>
                  <option value="Lab">Lab</option>
                  <option value="Lectorial">Lectorial</option>
                </select>
              </label>
              <label>
                Delivery Mode
                <select value={formData.delivery_mode || ""} onChange={(event) => updateForm("delivery_mode", event.target.value)}>
                  <option value="Face-to-face">Face-to-face</option>
                  <option value="Online">Online</option>
                  <option value="Hybrid">Hybrid</option>
                  <option value="Asynchronous">Asynchronous</option>
                </select>
              </label>
              <label>
                Campus Mode
                <select value={formData.campus_mode || ""} onChange={(event) => updateForm("campus_mode", event.target.value)}>
                  <option value="Physical">Physical</option>
                  <option value="Virtual">Virtual</option>
                </select>
              </label>
              <label>
                Duration (mins)
                <input
                  required
                  min="15"
                  step="15"
                  type="number"
                  value={formData.duration_minutes ?? ""}
                  onChange={(event) => updateForm("duration_minutes", event.target.value ? Number.parseInt(event.target.value, 10) : null)}
                />
              </label>
              <label>
                Sessions Per Week
                <input
                  required
                  min="1"
                  type="number"
                  value={formData.sessions_per_week ?? ""}
                  onChange={(event) => updateForm("sessions_per_week", event.target.value ? Number.parseInt(event.target.value, 10) : null)}
                />
              </label>
              <label>
                Start Week
                <input
                  required
                  min="1"
                  type="number"
                  value={formData.start_week ?? ""}
                  onChange={(event) => updateForm("start_week", event.target.value ? Number.parseInt(event.target.value, 10) : null)}
                />
              </label>
              <label>
                End Week
                <input
                  required
                  min="1"
                  type="number"
                  value={formData.end_week ?? ""}
                  onChange={(event) => updateForm("end_week", event.target.value ? Number.parseInt(event.target.value, 10) : null)}
                />
              </label>
              <label>
                Week Pattern
                <select value={formData.week_pattern || ""} onChange={(event) => updateForm("week_pattern", event.target.value)}>
                  <option value="Weekly">Weekly</option>
                  <option value="Odd">Odd</option>
                  <option value="Even">Even</option>
                  <option value="Custom">Custom</option>
                </select>
              </label>
              {formData.week_pattern === "Custom" && (
                <label>
                  Custom Weeks
                  <input placeholder="e.g. 1,2,3" value={formData.custom_weeks || ""} onChange={(event) => updateForm("custom_weeks", event.target.value)} />
                </label>
              )}
              <label>
                Scheduling Type
                <select value={formData.scheduling_type || ""} onChange={(event) => updateForm("scheduling_type", event.target.value)}>
                  <option value="Flexible">Flexible</option>
                  <option value="Fixed">Fixed</option>
                </select>
              </label>
              {formData.scheduling_type === "Fixed" && (
                <>
                  <label>
                    Fixed Day
                    <select value={formData.fixed_day || ""} onChange={(event) => updateForm("fixed_day", event.target.value)}>
                      <option value="">Select Day</option>
                      <option value="Monday">Monday</option>
                      <option value="Tuesday">Tuesday</option>
                      <option value="Wednesday">Wednesday</option>
                      <option value="Thursday">Thursday</option>
                      <option value="Friday">Friday</option>
                    </select>
                  </label>
                  <label>
                    Fixed Start Time
                    <input type="time" value={formData.fixed_start_time || ""} onChange={(event) => updateForm("fixed_start_time", event.target.value)} />
                  </label>
                  <label>
                    Fixed End Time
                    <input type="time" value={formData.fixed_end_time || ""} onChange={(event) => updateForm("fixed_end_time", event.target.value)} />
                  </label>
                </>
              )}
              {formData.scheduling_type === "Flexible" && (
                <>
                  <label>
                    Preferred Days
                    <input placeholder="e.g. Monday, Wednesday" value={formData.preferred_days || ""} onChange={(event) => updateForm("preferred_days", event.target.value)} />
                  </label>
                  <label>
                    Avoid Days
                    <input placeholder="e.g. Friday" value={formData.avoid_days || ""} onChange={(event) => updateForm("avoid_days", event.target.value)} />
                  </label>
                  <label>
                    Priority
                    <select value={formData.priority || ""} onChange={(event) => updateForm("priority", event.target.value)}>
                      <option value="Normal">Normal</option>
                      <option value="Hard">Hard (Strict Constraints)</option>
                    </select>
                  </label>
                </>
              )}
              <label>
                Remarks
                <input value={formData.remarks || ""} onChange={(event) => updateForm("remarks", event.target.value)} />
              </label>
            </div>
            <div className="modal-footer">
              <button className="button secondary" type="button" onClick={() => setIsModalOpen(false)}>
                Cancel
              </button>
              <button className="button" disabled={saving} type="submit">
                {saving ? "Saving..." : "Save Requirement"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

export default function UploadPage() {
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);

  const handleUpload = async (files: File[]) => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const nextSummary = await uploadTemplate(files);
      setSummary(nextSummary);
      if (nextSummary.rows_failed > 0) {
        // Failed uploads are all-or-nothing, so keep the old table visible.
        setError("No requirements were imported because validation failed. Fix the row-level errors below and upload again.");
      } else {
        setRefreshSignal((current) => current + 1);
        notifyWorkflowProgressChange();
      }
    } catch (err) {
      setError(formatApiError(err, "Upload failed"));
    } finally {
      setBusy(false);
    }
  };

  const handleResetRequirements = async () => {
    if (!window.confirm("Reset all requirement inputs? This clears imported/manual requirements and any generated schedule state.")) {
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await resetRequirementInputs();
      setSummary(null);
      setSuccess(`${result.message} Cleared ${result.rows_deleted} requirement${result.rows_deleted === 1 ? "" : "s"}.`);
      setRefreshSignal((current) => current + 1);
      notifyWorkflowProgressChange();
    } catch (err) {
      setError(formatApiError(err, "Reset failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Import Requirements</h1>
          <p>Import and combine one or more requirements workbooks</p>
        </div>
        <button className="button danger" onClick={handleResetRequirements} disabled={busy} type="button">
          <RotateCcw size={17} />
          Reset Requirements
        </button>
      </div>
      <UploadBox busy={busy} onUpload={handleUpload} />
      {error && <div className="notice bad">{error}</div>}
      {success && <div className="notice good">{success}</div>}
      {summary && (
        <section className="metric-grid compact">
          <div className="metric-card">
            <span>Rows read</span>
            <strong>{summary.rows_read}</strong>
          </div>
          <div className="metric-card">
            <span>Imported</span>
            <strong>{summary.rows_imported}</strong>
          </div>
          <div className="metric-card">
            <span>Failed</span>
            <strong>{summary.rows_failed}</strong>
          </div>
        </section>
      )}
      {summary && summary.errors.length > 0 && (
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
              {summary.errors.map((item, index) => (
                <tr key={`${item.row}-${index}`}>
                  <td>{item.row}</td>
                  <td>{item.field}</td>
                  <td>{item.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <RequirementsEditor refreshSignal={refreshSignal} />
    </div>
  );
}
