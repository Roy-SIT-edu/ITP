/*
 * Review page.
 * Displays the latest generated timetable and any stored constraint violations.
 */

import { AlertTriangle, ChevronDown, Filter, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
} from "../api/client";
import AuditSideDrawer from "../components/AuditSideDrawer";
import StatusBadge from "../components/StatusBadge";
import TimetableGrid from "../components/TimetableGrid";
import WeeklyCalendarView from "../components/WeeklyCalendarView";
import { useSessionState } from "../sessionState";
import type {
  ConstraintViolation,
  Room,
  ScheduleComparison,
  ScheduleExplanation,
  ScheduleResponse,
  ScheduleRun,
  ScheduledRow,
  TimeSlot,
} from "../types";

type Filters = {
  programme: string;
  group: string;
  staff: string;
  room: string;
  day: string;
  weekType: WeekTypeFilter;
};

type MoveDraft = {
  day: string;
  start_time: string;
  end_time: string;
  room_code: string;
};

type WeekTypeFilter = "all" | "odd" | "even";

const emptyFilters: Filters = {
  programme: "",
  group: "",
  staff: "",
  room: "",
  day: "",
  weekType: "all",
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
  const [termStartDate, setTermStartDate] = useSessionState<string>("review.termStartDate", "");
  const [moveDrafts, setMoveDrafts] = useSessionState<Record<number, MoveDraft>>("review.moveDrafts", {});
  const [selectedSessionId, setSelectedSessionId] = useSessionState<number | null>("review.selectedSessionId", null);
  const [savingMove, setSavingMove] = useState<number | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [error, setError] = useSessionState<string | null>("review.error", null);

  const load = async () => {
    setError(null);
    try {
      const latest = await getLatestSchedule();
      setSchedule(latest);
      const [nextViolations, nextRuns, nextComparisons, nextExplanations, nextRooms, nextTimeSlots] = await Promise.all([
        getViolations(latest.schedule_run.id),
        getScheduleRuns(),
        compareSchedules(),
        getScheduleExplanations(latest.schedule_run.id),
        getRooms(),
        getTimeSlots(),
      ]);
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
    }
  };

  useEffect(() => {
    load();
  }, []);

  const rows = schedule?.scheduled_sessions ?? [];
  const filteredRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          matches(row.programme, filters.programme) &&
          matches(row.student_group_code, filters.group) &&
          matches(row.staff_name, filters.staff) &&
          matches(row.room, filters.room) &&
          matches(row.day, filters.day) &&
          matchesWeekType(row.week_pattern, filters.weekType),
      ),
    [filters, rows],
  );
  const termWeek = useMemo(() => currentTermWeek(termStartDate), [termStartDate]);

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

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Review Timetable</h1>
          <p>Inspect and adjust the generated timetable</p>
        </div>
        <div className="toolbar-row">
          <button className="button secondary" onClick={() => setAuditOpen(true)}>
            <AlertTriangle size={17} />
            Conflicts ({violations.length})
          </button>
          <button className="button secondary" onClick={load}>
            <RefreshCw size={17} />
            Refresh
          </button>
        </div>
      </div>
      {error && <div className="notice bad">{error}</div>}
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
              <FilterSelect label="Programme" value={filters.programme} values={unique(rows, "programme")} onChange={(value) => setFilters({ ...filters, programme: value })} />
              <FilterSelect label="Group" value={filters.group} values={unique(rows, "student_group_code")} onChange={(value) => setFilters({ ...filters, group: value })} />
              <FilterSelect label="Staff" value={filters.staff} values={unique(rows, "staff_name")} onChange={(value) => setFilters({ ...filters, staff: value })} />
              <FilterSelect label="Room" value={filters.room} values={unique(rows, "room")} onChange={(value) => setFilters({ ...filters, room: value })} />
              <FilterSelect label="Day" value={filters.day} values={unique(rows, "day")} onChange={(value) => setFilters({ ...filters, day: value })} />
              <label>
                <span>Week Type</span>
                <select value={filters.weekType} onChange={(event) => setFilters({ ...filters, weekType: event.target.value as WeekTypeFilter })}>
                  <option value="all">All</option>
                  <option value="odd">Odd Weeks</option>
                  <option value="even">Even Weeks</option>
                </select>
              </label>
              <label>
                <span>Term Start Date</span>
                <input type="date" value={termStartDate} onChange={(event) => setTermStartDate(event.target.value)} />
              </label>
              {termWeek && (
                <span className={`week-cycle-chip ${termWeek.cycle}`}>
                  Week {termWeek.weekNumber} {termWeek.cycle === "odd" ? "Odd" : "Even"}
                </span>
              )}
              <button className="button secondary slim" onClick={() => setFilters(emptyFilters)}>
                Clear
              </button>
            </div>
            <WeeklyCalendarView
              rows={filteredRows}
              selectedSessionId={selectedSessionId}
              onSelectSession={setSelectedSessionId}
            />
            <TimetableGrid
              rows={filteredRows}
              editable
              rooms={rooms}
              timeSlots={timeSlots}
              moveDrafts={moveDrafts}
              savingMove={savingMove}
              showPlanner={false}
              selectedSessionId={selectedSessionId}
              onChangeMove={setMoveDraft}
              onSaveMove={saveMove}
              onSelectSession={setSelectedSessionId}
            />
          </section>
        </>
      )}
      <AuditSideDrawer
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        violations={violations}
        explanations={explanations}
        rows={rows}
        rooms={rooms}
        comparisons={comparisons}
        onSelectSession={setSelectedSessionId}
      />
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
  return Array.from(new Set(rows.map((row) => row[key]).filter(Boolean).map(String))).sort();
}

function matches(value: string | null, filter: string) {
  return !filter || value === filter;
}

function matchesWeekType(weekPattern: string | null, filter: WeekTypeFilter) {
  if (filter === "all") return true;
  const normalized = (weekPattern ?? "Weekly").toLowerCase();
  if (normalized === "weekly" || normalized === "every") return true;
  return normalized === filter;
}

function currentTermWeek(termStartDate: string) {
  if (!termStartDate) return null;
  const start = new Date(`${termStartDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.floor((todayStart.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return null;
  const weekNumber = Math.floor(diffDays / 7) + 1;
  return {
    weekNumber,
    cycle: weekNumber % 2 === 1 ? "odd" : "even",
  };
}
