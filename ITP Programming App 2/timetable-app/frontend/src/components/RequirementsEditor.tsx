/*
 * Requirement editor and constraint builder used during validation.
 * Lets users fix saved requirement rows without leaving the Validation tab.
 */

import { Edit2, Filter, Plus, RefreshCw, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { createSession, deleteSession, getSessions, updateSession } from "../api/client";
import { formatApiError } from "../api/errors";
import ConstraintStudio, { type ConstraintPresetValues } from "./ConstraintStudio";
import RequirementFormModal, { type RequirementFormData } from "./RequirementFormModal";
import { notifyWorkflowProgressChange } from "./WorkflowProgress";
import type { SessionRow } from "../types";

type Props = {
  refreshSignal?: number;
  onChanged?: () => void;
};

const emptySession: RequirementFormData = {
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

export default function RequirementsEditor({ refreshSignal = 0, onChanged }: Props) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<SessionRow | null>(null);
  const [formData, setFormData] = useState<RequirementFormData>(emptySession);

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
    void load();
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
        session.co_teacher_names,
        session.co_teacher_ids,
        session.programme,
      ].some((value) => (value || "").toLowerCase().includes(query)),
    );
  }, [search, sessions]);

  const afterMutation = async (message: string) => {
    setSuccess(message);
    await load();
    notifyWorkflowProgressChange();
    onChanged?.();
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
      await afterMutation("Requirement deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deletion failed");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!formData.staff_id?.trim()) {
      setError("Please provide Staff 1 ID.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editingSession) {
        await updateSession(editingSession.id, formData);
        await afterMutation("Requirement updated.");
      } else {
        await createSession(formData);
        await afterMutation("Requirement added.");
      }
      setIsModalOpen(false);
    } catch (err) {
      setError(formatApiError(err, "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  const updateForm = (key: keyof RequirementFormData, value: string | number | null) => {
    setFormData((previous) => ({ ...previous, [key]: value }));
  };

  const applyConstraintPreset = async (sessionId: number, values: ConstraintPresetValues) => {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload: Partial<SessionRow> = {
        ...session,
        preferred_days: values.mode === "soft" ? values.preferred_days : "",
        avoid_days: values.mode === "soft" ? values.avoid_days : "",
        scheduling_type: values.mode === "hard" ? "Fixed" : "Flexible",
        fixed_day: values.mode === "hard" ? values.fixed_day : "",
        fixed_start_time: values.mode === "hard" ? values.fixed_start_time : "",
        fixed_end_time: values.mode === "hard" ? values.fixed_end_time : "",
        priority: values.mode === "hard" ? "Hard" : "Normal",
      };
      await updateSession(session.id, payload);
      await afterMutation("Constraint settings applied.");
    } catch (err) {
      setError(formatApiError(err, "Could not apply constraints"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="requirements-editor" id="requirements-editor">
      <div className="section-heading">
        <div>
          <h2>Requirements</h2>
          <p>Fix imported teaching requirements before ranking soft constraints</p>
        </div>
        <div className="toolbar-row">
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

      <ConstraintStudio sessions={sessions} disabled={saving || loading} onApply={applyConstraintPreset} />

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
                <td>{row.co_teacher_names || row.staff_name || row.staff_id}</td>
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
        <RequirementFormModal
          editingSession={editingSession}
          formData={formData}
          saving={saving}
          onClose={() => setIsModalOpen(false)}
          onSubmit={handleSave}
          onUpdate={updateForm}
        />
      )}
    </section>
  );
}
