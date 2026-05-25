import { Filter, Play, Plus, RefreshCw, Trash2, Edit2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getSessions, createSession, updateSession, deleteSession, generateSchedule } from "../api/client";
import type { SessionRow } from "../types";

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

export default function RequirementsPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<SessionRow | null>(null);
  const [formData, setFormData] = useState<Omit<SessionRow, "id">>(emptySession);

  const load = async () => {
    setError(null);
    try {
      setSessions(await getSessions());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load sessions");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filteredSessions = useMemo(() => {
    const query = search.toLowerCase();
    if (!query) return sessions;
    return sessions.filter((s) =>
      (s.requirement_id || "").toLowerCase().includes(query) ||
      (s.module_code || "").toLowerCase().includes(query) ||
      (s.student_group_code || "").toLowerCase().includes(query) ||
      (s.staff_name || "").toLowerCase().includes(query) ||
      (s.programme || "").toLowerCase().includes(query)
    );
  }, [search, sessions]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await generateSchedule();
      setSuccess(`Timetable regenerated successfully! Solver Status: ${result.solver_status}, Conflicts: ${result.hard_violation_count}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleOpenAdd = () => {
    setEditingSession(null);
    setFormData({ ...emptySession, requirement_id: `REQ-${String(sessions.length + 1).padStart(4, "0")}` });
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
    setIsModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Are you sure you want to delete this requirement?")) return;
    try {
      await deleteSession(id);
      setSuccess("Requirement deleted.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deletion failed");
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.staff_name?.trim() && !formData.staff_id?.trim()) {
      setError("Please provide either a Staff Name or a Staff ID.");
      return;
    }
    
    setLoading(true);
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
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setLoading(false);
    }
  };

  const updateForm = (key: keyof typeof formData, value: any) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Requirements</h1>
          <p>Manage academic class requirements</p>
        </div>
        <div style={{ display: "flex", gap: "12px" }}>
          <button className="button" onClick={handleGenerate} disabled={generating}>
            {generating ? <RefreshCw className="spin" size={17} /> : <Play size={17} />}
            Regenerate Timetable
          </button>
          <button className="button secondary" onClick={load}>
            <RefreshCw size={17} />
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="notice bad">{error}</div>}
      {success && <div className="notice good">{success}</div>}

      <div className="filter-bar" style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <Filter size={18} />
          <input
            type="text"
            placeholder="Search module, staff, group..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: "250px", height: "36px", padding: "0 10px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
          />
        </div>
        <button className="button" onClick={handleOpenAdd}>
          <Plus size={18} /> Add Requirement
        </button>
      </div>

      <div className="table-wrap">
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
                <td style={{ display: "flex", gap: "8px" }}>
                  <button className="button secondary slim" title="Edit" onClick={() => handleOpenEdit(row)} style={{ padding: "0 6px" }}>
                    <Edit2 size={14} />
                  </button>
                  <button className="button slim" title="Delete" onClick={() => handleDelete(row.id)} style={{ padding: "0 6px", background: "#fee2e2", borderColor: "#fca5a5", color: "#991b1b" }}>
                    <Trash2 size={14} />
                  </button>
                </td>
                <td>{row.requirement_id}</td>
                <td>{row.programme}</td>
                <td>{row.module_code}</td>
                <td>{row.student_group_code}</td>
                <td>{row.staff_name}</td>
                <td>{row.class_type} ({row.delivery_mode})</td>
                <td>{row.duration_minutes}m</td>
                <td>{row.exact_class_size}</td>
                <td>
                  {row.scheduling_type === "Fixed" 
                    ? <span className="status-badge warn">Fixed: {row.fixed_day} {row.fixed_start_time}</span>
                    : <span className="status-badge good">Flexible</span>}
                </td>
              </tr>
            ))}
            {filteredSessions.length === 0 && (
              <tr>
                <td colSpan={10} style={{ textAlign: "center", padding: "24px" }}>No sessions found.</td>
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
              <button type="button" className="button secondary slim" onClick={() => setIsModalOpen(false)}>Close</button>
            </div>
            <div className="modal-body">
              <label>Requirement ID <input required value={formData.requirement_id || ""} onChange={(e) => updateForm("requirement_id", e.target.value)} /></label>
              <label>Programme <input required placeholder="e.g. DSC" value={formData.programme || ""} onChange={(e) => updateForm("programme", e.target.value)} /></label>
              <label>Module Code <input required placeholder="e.g. DSC2204" value={formData.module_code || ""} onChange={(e) => updateForm("module_code", e.target.value)} /></label>
              <label>Student Group <input required placeholder="e.g. DSC-Y2-G1" value={formData.student_group_code || ""} onChange={(e) => updateForm("student_group_code", e.target.value)} /></label>
              <label>Exact Class Size <input required type="number" min="1" value={formData.exact_class_size ?? ""} onChange={(e) => updateForm("exact_class_size", e.target.value ? parseInt(e.target.value) : null)} /></label>
              
              <label>Staff Name <input value={formData.staff_name || ""} onChange={(e) => updateForm("staff_name", e.target.value)} /></label>
              <label>Staff ID <input value={formData.staff_id || ""} onChange={(e) => updateForm("staff_id", e.target.value)} /></label>
              
              <label>Class Type
                <select value={formData.class_type || ""} onChange={(e) => updateForm("class_type", e.target.value)}>
                  <option value="Lecture">Lecture</option>
                  <option value="Tutorial">Tutorial</option>
                  <option value="Lab">Lab</option>
                  <option value="Lectorial">Lectorial</option>
                </select>
              </label>
              <label>Delivery Mode
                <select value={formData.delivery_mode || ""} onChange={(e) => updateForm("delivery_mode", e.target.value)}>
                  <option value="Face-to-face">Face-to-face</option>
                  <option value="Online">Online</option>
                  <option value="Hybrid">Hybrid</option>
                  <option value="Asynchronous">Asynchronous</option>
                </select>
              </label>
              <label>Campus Mode
                <select value={formData.campus_mode || ""} onChange={(e) => updateForm("campus_mode", e.target.value)}>
                  <option value="Physical">Physical</option>
                  <option value="Virtual">Virtual</option>
                </select>
              </label>
              
              <label>Duration (mins) <input required type="number" step="15" min="15" value={formData.duration_minutes ?? ""} onChange={(e) => updateForm("duration_minutes", e.target.value ? parseInt(e.target.value) : null)} /></label>
              <label>Sessions Per Week <input required type="number" min="1" value={formData.sessions_per_week ?? ""} onChange={(e) => updateForm("sessions_per_week", e.target.value ? parseInt(e.target.value) : null)} /></label>
              
              <label>Start Week <input required type="number" min="1" value={formData.start_week ?? ""} onChange={(e) => updateForm("start_week", e.target.value ? parseInt(e.target.value) : null)} /></label>
              <label>End Week <input required type="number" min="1" value={formData.end_week ?? ""} onChange={(e) => updateForm("end_week", e.target.value ? parseInt(e.target.value) : null)} /></label>
              
              <label>Week Pattern
                <select value={formData.week_pattern || ""} onChange={(e) => updateForm("week_pattern", e.target.value)}>
                  <option value="Weekly">Weekly</option>
                  <option value="Odd">Odd</option>
                  <option value="Even">Even</option>
                  <option value="Custom">Custom</option>
                </select>
              </label>
              
              {formData.week_pattern === "Custom" && (
                <label>Custom Weeks <input placeholder="e.g. 1,2,3" value={formData.custom_weeks || ""} onChange={(e) => updateForm("custom_weeks", e.target.value)} /></label>
              )}

              <label>Scheduling Type
                <select value={formData.scheduling_type || ""} onChange={(e) => updateForm("scheduling_type", e.target.value)}>
                  <option value="Flexible">Flexible</option>
                  <option value="Fixed">Fixed</option>
                </select>
              </label>

              {formData.scheduling_type === "Fixed" && (
                <>
                  <label>Fixed Day
                    <select value={formData.fixed_day || ""} onChange={(e) => updateForm("fixed_day", e.target.value)}>
                      <option value="">Select Day</option>
                      <option value="Monday">Monday</option>
                      <option value="Tuesday">Tuesday</option>
                      <option value="Wednesday">Wednesday</option>
                      <option value="Thursday">Thursday</option>
                      <option value="Friday">Friday</option>
                    </select>
                  </label>
                  <label>Fixed Start Time <input type="time" value={formData.fixed_start_time || ""} onChange={(e) => updateForm("fixed_start_time", e.target.value)} /></label>
                  <label>Fixed End Time <input type="time" value={formData.fixed_end_time || ""} onChange={(e) => updateForm("fixed_end_time", e.target.value)} /></label>
                </>
              )}

              {formData.scheduling_type === "Flexible" && (
                <>
                  <label>Preferred Days <input placeholder="e.g. Monday, Wednesday" value={formData.preferred_days || ""} onChange={(e) => updateForm("preferred_days", e.target.value)} /></label>
                  <label>Avoid Days <input placeholder="e.g. Friday" value={formData.avoid_days || ""} onChange={(e) => updateForm("avoid_days", e.target.value)} /></label>
                  <label>Priority
                    <select value={formData.priority || ""} onChange={(e) => updateForm("priority", e.target.value)}>
                      <option value="Normal">Normal</option>
                      <option value="Hard">Hard (Strict Constraints)</option>
                    </select>
                  </label>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="button secondary" onClick={() => setIsModalOpen(false)}>Cancel</button>
              <button type="submit" className="button" disabled={loading}>{loading ? "Saving..." : "Save Requirement"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
