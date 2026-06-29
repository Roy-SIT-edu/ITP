/*
 * Review page.
 * Displays the latest generated timetable and any stored constraint violations.
 */

import { ChevronDown, Filter, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  compareSchedules,
  getLatestSchedule,
  getRooms,
  getSchedule,
  getScheduleExplanations,
  getScheduleRuns,
  getTimeSlots,
  getViolations,
  moveScheduledSession,
  getSession,
  updateSession,
  recheckSchedule,
  generateSchedule,
  autoResolveSchedule,
} from "../api/client";
import ConflictTable from "../components/ConflictTable";
import InlineActivity from "../components/InlineActivity";
import LiveProgress from "../components/LiveProgress";
import StatusBadge from "../components/StatusBadge";
import TimetableGrid from "../components/TimetableGrid";
import { days } from "../components/timetable/types";
import { timeToMinutes } from "../components/timetable/timetableUtils";
import { useSessionState } from "../sessionState";
import type {
  ConstraintViolation,
  Room,
  ScheduleComparison,
  ScheduleExplanation,
  ScheduleResponse,
  ScheduleRun,
  ScheduledRow,
  SessionRow,
  TimeSlot,
} from "../types";

type Filters = {
  programme: string;
  group: string;
  staff: string;
  room: string;
  day: string;
};

type MoveDraft = {
  day: string;
  start_time: string;
  end_time: string;
  room_code: string;
};

const emptyFilters: Filters = {
  programme: "",
  group: "",
  staff: "",
  room: "",
  day: "",
};

export default function TimetableReviewPage() {
  const [schedule, setSchedule] = useSessionState<ScheduleResponse | null>("review.schedule", null);
  const [violations, setViolations] = useSessionState<ConstraintViolation[]>("review.violations", []);
  const [runs, setRuns] = useSessionState<ScheduleRun[]>("review.runs", []);
  const [comparisons, setComparisons] = useSessionState<ScheduleComparison[]>("review.comparisons", []);
  const [explanations, setExplanations] = useSessionState<ScheduleExplanation[]>("review.explanations", []);
  const [rooms, setRooms] = useSessionState<Room[]>("review.rooms", []);
  const [timeSlots, setTimeSlots] = useSessionState<TimeSlot[]>("review.timeSlots", []);
  const [filters, setFilters] = useSessionState<Filters>("review.filters", emptyFilters);
  const [moveDrafts, setMoveDrafts] = useSessionState<Record<number, MoveDraft>>("review.moveDrafts", {});
  const [savingMove, setSavingMove] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useSessionState<string | null>("review.error", null);
  const [activeSessionId, setActiveSessionId] = useSessionState<number | null>("review.activeSessionId", null);
  const [movingConflict, setMovingConflict] = useState(false);
  const [conflictTab, setConflictTab] = useSessionState<"modules" | "issues">("review.conflictTab", "modules");

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const latest = await getLatestSchedule();
      setSchedule(latest);
      const [nextViolations, nextRuns, nextComparisons, nextExplanations, nextRooms, nextTimeSlots] = await Promise.all(
        [
          getViolations(latest.schedule_run.id),
          getScheduleRuns(),
          compareSchedules(),
          getScheduleExplanations(latest.schedule_run.id),
          getRooms(),
          getTimeSlots(),
        ],
      );
      setViolations(nextViolations);
      setRuns(nextRuns);
      setComparisons(nextComparisons);
      setExplanations(nextExplanations);
      setRooms(nextRooms);
      setTimeSlots(nextTimeSlots);
    } catch (err) {
      setSchedule(null);
      setViolations([]);
      setError(err instanceof Error ? err.message : "Could not load schedule");
    } finally {
      setLoading(false);
    }
  }, [setComparisons, setError, setExplanations, setRooms, setRuns, setSchedule, setTimeSlots, setViolations]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => schedule?.scheduled_sessions ?? [], [schedule]);
  const filteredRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          matches(row.programme, filters.programme) &&
          matches(row.student_group_code, filters.group) &&
          matches(row.co_teacher_names || row.staff_name, filters.staff) &&
          matches(row.room, filters.room) &&
          matches(row.day, filters.day),
      ),
    [filters, rows],
  );

  const conflictSlotKeys = useMemo(() => {
    if (!activeSessionId) return new Set<string>();
    const keys = new Set<string>();
    for (const row of rows) {
      if (row.session_id === activeSessionId) {
        const startMin = timeToMinutes(row.start_time);
        const endMin = timeToMinutes(row.end_time);
        for (let h = Math.floor(startMin / 60); h < Math.ceil(endMin / 60); h++) {
          const s = `${String(h).padStart(2, "0")}:00`;
          const e = `${String(h + 1).padStart(2, "0")}:00`;
          keys.add(`${row.day}|${s}|${e}`);
        }
      }
    }
    return keys;
  }, [activeSessionId, rows]);

  const availableSlotKeys = useMemo(() => {
    if (!activeSessionId) return new Set<string>();
    const occupied = new Set<string>();
    for (const row of rows) {
      const startMin = timeToMinutes(row.start_time);
      const endMin = timeToMinutes(row.end_time);
      for (let h = Math.floor(startMin / 60); h < Math.ceil(endMin / 60); h++) {
        const s = `${String(h).padStart(2, "0")}:00`;
        const e = `${String(h + 1).padStart(2, "0")}:00`;
        occupied.add(`${row.day}|${s}|${e}`);
      }
    }
    const available = new Set<string>();
    const hours = new Set<number>();
    for (const slot of timeSlots) {
      const h = parseInt(slot.start_time.split(":")[0], 10);
      hours.add(h);
    }
    if (hours.size === 0) {
      for (let h = 8; h < 18; h++) hours.add(h);
    }
    for (const day of days) {
      for (const h of hours) {
        const s = `${String(h).padStart(2, "0")}:00`;
        const e = `${String(h + 1).padStart(2, "0")}:00`;
        const key = `${day}|${s}|${e}`;
        if (!occupied.has(key) && !conflictSlotKeys.has(key)) {
          available.add(key);
        }
      }
    }
    return available;
  }, [activeSessionId, rows, timeSlots, conflictSlotKeys]);

  const openRun = async (id: number) => {
    setError(null);
    try {
      const nextSchedule = await getSchedule(id);
      setSchedule(nextSchedule);
      setViolations(await getViolations(id));
      setExplanations(await getScheduleExplanations(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open schedule run");
    }
  };

  const setMoveDraft = (sessionId: number, value: MoveDraft) => {
    setMoveDrafts((current) => ({ ...current, [sessionId]: value }));
  };

  const saveMove = async (row: ScheduledRow) => {
    if (!schedule) return;
    const draft = moveDrafts[row.session_id] ?? {
      day: row.day,
      start_time: row.start_time,
      end_time: row.end_time,
      room_code: row.room,
    };
    setSavingMove(row.session_id);
    setError(null);
    try {
      await moveScheduledSession(schedule.schedule_run.id, row.session_id, draft);
      const refreshed = await getSchedule(schedule.schedule_run.id);
      setSchedule(refreshed);
      setViolations(await getViolations(schedule.schedule_run.id));
      setExplanations(await getScheduleExplanations(schedule.schedule_run.id));
      setComparisons(await compareSchedules());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move scheduled session");
    } finally {
      setSavingMove(null);
    }
  };

  const handleConflictMove = async (day: string, startTime: string, _endTime: string) => {
    if (!schedule || !activeSessionId || movingConflict) return;
    const targetRow = rows.find((r) => r.session_id === activeSessionId);
    if (!targetRow) return;

    const durationMin = timeToMinutes(targetRow.end_time) - timeToMinutes(targetRow.start_time);
    const newStartMin = timeToMinutes(startTime);
    const newEndMin = newStartMin + durationMin;
    const newEndHour = Math.floor(newEndMin / 60);
    const newEndMinute = newEndMin % 60;
    const computedEndTime = `${String(newEndHour).padStart(2, "0")}:${String(newEndMinute).padStart(2, "0")}`;

    setMovingConflict(true);
    setError(null);
    try {
      await moveScheduledSession(schedule.schedule_run.id, activeSessionId, {
        day,
        start_time: startTime,
        end_time: computedEndTime,
        room_code: targetRow.room,
      });
      const refreshed = await getSchedule(schedule.schedule_run.id);
      setSchedule(refreshed);
      const newViolations = await getViolations(schedule.schedule_run.id);
      setViolations(newViolations);
      setExplanations(await getScheduleExplanations(schedule.schedule_run.id));
      setComparisons(await compareSchedules());
      setActiveSessionId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move session");
    } finally {
      setMovingConflict(false);
    }
  };

  const conflictSessionIds = useMemo(() => {
    const ids = new Set<number>();
    for (const v of violations) {
      for (const id of v.affected_session_ids) ids.add(id);
    }
    return ids;
  }, [violations]);

  const conflictSessions = useMemo(() => {
    return rows.filter((r) => conflictSessionIds.has(r.session_id));
  }, [rows, conflictSessionIds]);

  const handleAutoResolve = async () => {
    setResolving(true);
    setError(null);
    try {
      await autoResolveSchedule();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve conflicts");
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Review Timetable</h1>
          <p>Inspect and adjust the generated timetable</p>
        </div>
        <div className="toolbar-row">
          <button className="button secondary" onClick={load} disabled={loading || resolving}>
            <RefreshCw className={loading && !resolving ? "spin" : ""} size={17} />
            Refresh
          </button>
          <button className="button primary" onClick={handleAutoResolve} disabled={loading || resolving}>
            {resolving && <RefreshCw className="spin" size={17} />}
            {resolving ? "Resolving..." : "Resolve Conflicts"}
          </button>
        </div>
      </div>
      {error && <div className="notice bad">{error}</div>}

      {resolving ? (
        <LiveProgress />
      ) : loading ? (
        <InlineActivity
          kind="review"
          title="Preparing timetable review"
          steps={["Loading latest run", "Reading conflicts", "Building timetable view"]}
        />
      ) : null}

      {schedule && (
        <>
          <section className="status-card review-summary">
            <div className="section-heading">
              <div>
                <div className="status-card-title">Current Schedule</div>
                <p>Run {schedule.schedule_run.id}</p>
              </div>
              <div className="status-row compact">
                <StatusBadge
                  label={schedule.schedule_run.solver_status ?? schedule.schedule_run.status}
                  tone={schedule.schedule_run.hard_violation_count > 0 ? "bad" : "good"}
                />
                <span>{filteredRows.length} sessions shown</span>
                <span>{violations.length} issues</span>
              </div>
            </div>
          </section>
          <details className="status-card compact-disclosure">
            <summary className="compact-summary">
              <div>
                <div className="status-card-title">Schedule Versions</div>
                <p>Compare recent generated runs</p>
              </div>
              <span className="preference-toggle">
                View
                <ChevronDown size={16} />
              </span>
            </summary>
            <div className="disclosure-content">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>Status</th>
                      <th>Sessions</th>
                      <th>Hard</th>
                      <th>Soft</th>
                      <th>Quality</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisons.map((run) => (
                      <tr key={run.id}>
                        <td>#{run.id}</td>
                        <td>{run.solver_status ?? run.status}</td>
                        <td>{run.scheduled_count}</td>
                        <td>{run.stored_hard_issues}</td>
                        <td>{run.soft_score}</td>
                        <td>{run.quality_score}</td>
                        <td>
                          <button className="button secondary slim" type="button" onClick={() => openRun(run.id)}>
                            Open
                          </button>
                        </td>
                      </tr>
                    ))}
                    {comparisons.length === 0 && (
                      <tr>
                        <td colSpan={7}>No schedule versions yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {runs.length > comparisons.length && <span className="muted">{runs.length} total runs available.</span>}
            </div>
          </details>
          <section className="status-card data-section">
            <div className="section-heading">
              <div>
                <div className="status-card-title">Timetable</div>
                <p>Filter, review, and manually adjust scheduled sessions</p>
              </div>
            </div>
            <div className="filter-bar">
              <Filter size={18} />
              <FilterSelect
                label="Programme"
                value={filters.programme}
                values={unique(rows, "programme")}
                onChange={(value) => setFilters({ ...filters, programme: value })}
              />
              <FilterSelect
                label="Group"
                value={filters.group}
                values={unique(rows, "student_group_code")}
                onChange={(value) => setFilters({ ...filters, group: value })}
              />
              <FilterSelect
                label="Staff"
                value={filters.staff}
                values={uniqueStaff(rows)}
                onChange={(value) => setFilters({ ...filters, staff: value })}
              />
              <FilterSelect
                label="Room"
                value={filters.room}
                values={unique(rows, "room")}
                onChange={(value) => setFilters({ ...filters, room: value })}
              />
              <FilterSelect
                label="Day"
                value={filters.day}
                values={unique(rows, "day")}
                onChange={(value) => setFilters({ ...filters, day: value })}
              />
              <button className="button secondary slim" onClick={() => setFilters(emptyFilters)}>
                Clear
              </button>
            </div>
            <TimetableGrid
              rows={filteredRows}
              allRows={rows}
              editable
              rooms={rooms}
              timeSlots={timeSlots}
              moveDrafts={moveDrafts}
              savingMove={savingMove}
              onChangeMove={setMoveDraft}
              onSaveMove={saveMove}
              conflictSlotKeys={conflictSlotKeys}
              availableSlotKeys={availableSlotKeys}
              onClickAvailableSlot={handleConflictMove}
              scheduleRunId={schedule.schedule_run.id}
              onRefresh={load}
            />
          </section>
          <section className="status-card data-section">
            <div className="section-heading">
              <div>
                <div className="status-card-title">Conflicts</div>
                <p>
                  {violations.length} issue{violations.length !== 1 ? "s" : ""} found —{" "}
                  {violations.some((v) => v.severity === "HARD") ? (
                    <strong style={{ color: "#dc2626" }}>Must resolve to finalize</strong>
                  ) : violations.length > 0 ? (
                    <span style={{ color: "#f97316" }}>Optional to resolve</span>
                  ) : (
                    <span className="muted">All clear!</span>
                  )}
                </p>
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  className={`button slim ${conflictTab === "modules" ? "" : "secondary"}`}
                  onClick={() => setConflictTab("modules")}
                >
                  Modules to Reassign
                </button>
                <button
                  className={`button slim ${conflictTab === "issues" ? "" : "secondary"}`}
                  onClick={() => setConflictTab("issues")}
                >
                  Raw Issues
                </button>
                {activeSessionId && (
                  <button className="button secondary slim" onClick={() => setActiveSessionId(null)}>
                    Clear Selection
                  </button>
                )}
              </div>
            </div>
            {movingConflict && (
              <InlineActivity
                kind="review"
                title="Moving session"
                steps={["Updating placement", "Checking conflicts", "Refreshing timetable"]}
              />
            )}
            {activeSessionId && (
              <div className="conflict-resolution-banner">
                Showing conflicts for Session <strong>{activeSessionId}</strong> — click a{" "}
                <span className="green-label">green slot</span> on the timetable to move it.
              </div>
            )}
            {conflictTab === "modules" ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Module / Requirement</th>
                      <th>Group</th>
                      <th>Staff</th>
                      <th>Current Time</th>
                      <th>Room</th>
                      <th>Issues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conflictSessions.map((row) => {
                      const rowViolations = violations.filter((v) => v.affected_session_ids.includes(row.session_id));
                      const isActive = activeSessionId === row.session_id;
                      const hasHard = rowViolations.some((v) => v.severity === "HARD");
                      const borderStyle = hasHard ? "4px solid #dc2626" : "4px solid #f97316";
                      return (
                        <tr
                          key={row.session_id}
                          className={isActive ? "conflict-active-row" : ""}
                          onClick={() => setActiveSessionId(row.session_id)}
                          style={{ cursor: "pointer" }}
                        >
                          <td style={{ borderLeft: borderStyle }}>{row.programme || `Req-${row.session_id}`}</td>
                          <td>{row.student_group_code}</td>
                          <td>{row.staff_name}</td>
                          <td>
                            {row.day} {row.start_time}-{row.end_time}
                          </td>
                          <td>{row.room}</td>
                          <td>{rowViolations.length} issue(s)</td>
                        </tr>
                      );
                    })}
                    {conflictSessions.length === 0 && (
                      <tr>
                        <td colSpan={6}>No modules with conflicts.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <ConflictTable
                violations={violations}
                activeConflictId={null}
                onSelectConflict={(v) => setActiveSessionId(v?.affected_session_ids[0] ?? null)}
              />
            )}
          </section>
          <section className="status-card review-explanation-card">
            <div className="section-heading">
              <div>
                <div className="status-card-title">Why This Schedule?</div>
                <p>Placement explanations for scheduled sessions</p>
              </div>
            </div>
            <div className="explanation-grid compact">
              {explanations.slice(0, 4).map((item) => (
                <article className="explanation-card" key={item.session_id}>
                  <strong>{item.module_code ?? item.requirement_id}</strong>
                  <span>{item.placement}</span>
                  <ul>
                    {item.reasons.slice(0, 3).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </article>
              ))}
              {explanations.length === 0 && (
                <div className="empty-state">No schedule explanations are available yet.</div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All</option>
        {values.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
    </label>
  );
}

function unique(rows: ScheduledRow[], key: keyof ScheduledRow) {
  return Array.from(
    new Set(
      rows
        .map((row) => row[key])
        .filter(Boolean)
        .map(String),
    ),
  ).sort();
}

function uniqueStaff(rows: ScheduledRow[]) {
  return Array.from(
    new Set(
      rows
        .map((row) => row.co_teacher_names || row.staff_name)
        .filter(Boolean)
        .map(String),
    ),
  ).sort();
}

function matches(value: string | null, filter: string) {
  return !filter || value === filter;
}
