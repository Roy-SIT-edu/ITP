/*
 * Review page.
 * Displays the latest generated timetable and any stored constraint violations.
 */

import { Filter, RefreshCw } from "lucide-react";
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
import ConflictTable from "../components/ConflictTable";
import StatusBadge from "../components/StatusBadge";
import TimetableGrid from "../components/TimetableGrid";
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
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [violations, setViolations] = useState<ConstraintViolation[]>([]);
  const [runs, setRuns] = useState<ScheduleRun[]>([]);
  const [comparisons, setComparisons] = useState<ScheduleComparison[]>([]);
  const [explanations, setExplanations] = useState<ScheduleExplanation[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [moveDrafts, setMoveDrafts] = useState<Record<number, MoveDraft>>({});
  const [savingMove, setSavingMove] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          matches(row.day, filters.day),
      ),
    [filters, rows],
  );

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
          <h1>Review</h1>
          <p>Generated timetable</p>
        </div>
        <button className="button secondary" onClick={load}>
          <RefreshCw size={17} />
          Refresh
        </button>
      </div>
      {error && <div className="notice bad">{error}</div>}
      {schedule && (
        <>
          <div className="status-row">
            <StatusBadge
              label={schedule.schedule_run.solver_status ?? schedule.schedule_run.status}
              tone={schedule.schedule_run.hard_violation_count > 0 ? "bad" : "good"}
            />
            <span>{filteredRows.length} sessions shown</span>
            <span>{violations.length} issues</span>
          </div>
          <section className="status-card">
            <div className="status-card-title">Schedule Versions</div>
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
          </section>
          <div className="filter-bar">
            <Filter size={18} />
            <FilterSelect label="Programme" value={filters.programme} values={unique(rows, "programme")} onChange={(value) => setFilters({ ...filters, programme: value })} />
            <FilterSelect label="Group" value={filters.group} values={unique(rows, "student_group_code")} onChange={(value) => setFilters({ ...filters, group: value })} />
            <FilterSelect label="Staff" value={filters.staff} values={unique(rows, "staff_name")} onChange={(value) => setFilters({ ...filters, staff: value })} />
            <FilterSelect label="Room" value={filters.room} values={unique(rows, "room")} onChange={(value) => setFilters({ ...filters, room: value })} />
            <FilterSelect label="Day" value={filters.day} values={unique(rows, "day")} onChange={(value) => setFilters({ ...filters, day: value })} />
            <button className="button secondary slim" onClick={() => setFilters(emptyFilters)}>
              Clear
            </button>
          </div>
          <TimetableGrid
            rows={filteredRows}
            editable
            rooms={rooms}
            timeSlots={timeSlots}
            moveDrafts={moveDrafts}
            savingMove={savingMove}
            onChangeMove={setMoveDraft}
            onSaveMove={saveMove}
          />
          <section className="status-card">
            <div className="status-card-title">Why This Schedule?</div>
            <div className="explanation-grid">
              {explanations.slice(0, 8).map((item) => (
                <article className="explanation-card" key={item.session_id}>
                  <strong>{item.module_code ?? item.requirement_id}</strong>
                  <span>{item.placement}</span>
                  <ul>
                    {item.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>
          <h2>Conflicts</h2>
          <ConflictTable violations={violations} />
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
  return Array.from(new Set(rows.map((row) => row[key]).filter(Boolean).map(String))).sort();
}

function matches(value: string | null, filter: string) {
  return !filter || value === filter;
}
