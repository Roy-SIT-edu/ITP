/*
 * Review page.
 * Displays the latest generated timetable and any stored constraint violations.
 */

import { Filter, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getLatestSchedule, getViolations } from "../api/client";
import ConflictTable from "../components/ConflictTable";
import StatusBadge from "../components/StatusBadge";
import TimetableGrid from "../components/TimetableGrid";
import type { ConstraintViolation, ScheduleResponse, ScheduledRow } from "../types";

type Filters = {
  programme: string;
  group: string;
  staff: string;
  room: string;
  day: string;
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
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const latest = await getLatestSchedule();
      setSchedule(latest);
      setViolations(await getViolations(latest.schedule_run.id));
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
          <TimetableGrid rows={filteredRows} />
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
