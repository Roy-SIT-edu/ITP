import type { FormEvent } from "react";
import type { SessionRow } from "../types";

export type RequirementFormData = Omit<SessionRow, "id">;

export default function RequirementFormModal({
  editingSession,
  formData,
  saving,
  onClose,
  onSubmit,
  onUpdate,
}: {
  editingSession: SessionRow | null;
  formData: RequirementFormData;
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUpdate: (key: keyof RequirementFormData, value: string | number | null) => void;
}) {
  return (
    <div className="modal-backdrop">
      <form className="modal-content" onSubmit={onSubmit}>
        <div className="modal-header">
          <h2>{editingSession ? "Edit Requirement" : "Add Requirement"}</h2>
          <button className="button secondary slim" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">
          <label>
            Requirement ID
            <input
              required
              value={formData.requirement_id || ""}
              onChange={(event) => onUpdate("requirement_id", event.target.value)}
            />
          </label>
          <label>
            Programme
            <input
              required
              placeholder="e.g. DSC"
              value={formData.programme || ""}
              onChange={(event) => onUpdate("programme", event.target.value)}
            />
          </label>
          <label>
            Module Code
            <input
              required
              placeholder="e.g. DSC2204"
              value={formData.module_code || ""}
              onChange={(event) => onUpdate("module_code", event.target.value)}
            />
          </label>
          <label>
            Student Group
            <input
              required
              placeholder="e.g. DSC-Y2-G1"
              value={formData.student_group_code || ""}
              onChange={(event) => onUpdate("student_group_code", event.target.value)}
            />
          </label>
          <label>
            Exact Class Size
            <input
              required
              min="1"
              type="number"
              value={formData.exact_class_size ?? ""}
              onChange={(event) =>
                onUpdate("exact_class_size", event.target.value ? Number.parseInt(event.target.value, 10) : null)
              }
            />
          </label>
          <label>
            Staff Name
            <input value={formData.staff_name || ""} onChange={(event) => onUpdate("staff_name", event.target.value)} />
          </label>
          <label>
            Staff ID
            <input value={formData.staff_id || ""} onChange={(event) => onUpdate("staff_id", event.target.value)} />
          </label>
          <label>
            Class Type
            <select value={formData.class_type || ""} onChange={(event) => onUpdate("class_type", event.target.value)}>
              <option value="Lecture">Lecture</option>
              <option value="Tutorial">Tutorial</option>
              <option value="Lab">Lab</option>
              <option value="Lectorial">Lectorial</option>
            </select>
          </label>
          <label>
            Delivery Mode
            <select
              value={formData.delivery_mode || ""}
              onChange={(event) => onUpdate("delivery_mode", event.target.value)}
            >
              <option value="Face-to-face">Face-to-face</option>
              <option value="Online">Online</option>
              <option value="Hybrid">Hybrid</option>
              <option value="Asynchronous">Asynchronous</option>
            </select>
          </label>
          <label>
            Campus Mode
            <select
              value={formData.campus_mode || ""}
              onChange={(event) => onUpdate("campus_mode", event.target.value)}
            >
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
              onChange={(event) =>
                onUpdate("duration_minutes", event.target.value ? Number.parseInt(event.target.value, 10) : null)
              }
            />
          </label>
          <label>
            Sessions Per Week
            <input
              required
              min="1"
              type="number"
              value={formData.sessions_per_week ?? ""}
              onChange={(event) =>
                onUpdate("sessions_per_week", event.target.value ? Number.parseInt(event.target.value, 10) : null)
              }
            />
          </label>
          <label>
            Start Week
            <input
              required
              min="1"
              type="number"
              value={formData.start_week ?? ""}
              onChange={(event) =>
                onUpdate("start_week", event.target.value ? Number.parseInt(event.target.value, 10) : null)
              }
            />
          </label>
          <label>
            End Week
            <input
              required
              min="1"
              type="number"
              value={formData.end_week ?? ""}
              onChange={(event) =>
                onUpdate("end_week", event.target.value ? Number.parseInt(event.target.value, 10) : null)
              }
            />
          </label>
          <label>
            Week Pattern
            <select
              value={formData.week_pattern || ""}
              onChange={(event) => onUpdate("week_pattern", event.target.value)}
            >
              <option value="Weekly">Weekly</option>
              <option value="Odd">Odd</option>
              <option value="Even">Even</option>
              <option value="Custom">Custom</option>
            </select>
          </label>
          {formData.week_pattern === "Custom" && (
            <label>
              Custom Weeks
              <input
                placeholder="e.g. 1,2,3"
                value={formData.custom_weeks || ""}
                onChange={(event) => onUpdate("custom_weeks", event.target.value)}
              />
            </label>
          )}
          <label>
            Scheduling Type
            <select
              value={formData.scheduling_type || ""}
              onChange={(event) => onUpdate("scheduling_type", event.target.value)}
            >
              <option value="Flexible">Flexible</option>
              <option value="Fixed">Fixed</option>
            </select>
          </label>
          {formData.scheduling_type === "Fixed" && (
            <>
              <label>
                Fixed Day
                <select
                  value={formData.fixed_day || ""}
                  onChange={(event) => onUpdate("fixed_day", event.target.value)}
                >
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
                <input
                  type="time"
                  value={formData.fixed_start_time || ""}
                  onChange={(event) => onUpdate("fixed_start_time", event.target.value)}
                />
              </label>
              <label>
                Fixed End Time
                <input
                  type="time"
                  value={formData.fixed_end_time || ""}
                  onChange={(event) => onUpdate("fixed_end_time", event.target.value)}
                />
              </label>
            </>
          )}
          {formData.scheduling_type === "Flexible" && (
            <>
              <label>
                Preferred Days
                <input
                  placeholder="e.g. Monday, Wednesday"
                  value={formData.preferred_days || ""}
                  onChange={(event) => onUpdate("preferred_days", event.target.value)}
                />
              </label>
              <label>
                Avoid Days
                <input
                  placeholder="e.g. Friday"
                  value={formData.avoid_days || ""}
                  onChange={(event) => onUpdate("avoid_days", event.target.value)}
                />
              </label>
              <label>
                Priority
                <select value={formData.priority || ""} onChange={(event) => onUpdate("priority", event.target.value)}>
                  <option value="Normal">Normal</option>
                  <option value="Hard">Hard (Strict Constraints)</option>
                </select>
              </label>
            </>
          )}
          <label>
            Remarks
            <input value={formData.remarks || ""} onChange={(event) => onUpdate("remarks", event.target.value)} />
          </label>
        </div>
        <div className="modal-footer">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button" disabled={saving} type="submit">
            {saving ? "Saving..." : "Save Requirement"}
          </button>
        </div>
      </form>
    </div>
  );
}
