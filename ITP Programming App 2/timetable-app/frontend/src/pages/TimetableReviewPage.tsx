/*
 * Review page.
 * Displays the latest generated timetable and any stored constraint violations.
 */

import { ChevronDown, FileText, Filter, RefreshCw, Zap } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  compareSchedules,
  getLatestSchedule,
  getRooms,
  getSchedule,
  getScheduleRuns,
  getTimeSlots,
  getViolations,
  moveScheduledSession,
  suggestScheduleFixes,
} from "../api/client";
import ConflictTable from "../components/ConflictTable";
import InlineActivity from "../components/InlineActivity";
import OptimisedScoreInfo from "../components/OptimisedScoreInfo";
import StatusBadge from "../components/StatusBadge";
import TimetableGrid from "../components/TimetableGrid";
import { notifyWorkflowProgressChange } from "../components/WorkflowProgress";
import { intervalsOverlap, timeToMinutes } from "../components/timetable/timetableUtils";
import { useSessionState } from "../sessionState";
import type {
  ConstraintViolation,
  QuickFixSuggestion,
  Room,
  ScheduleComparison,
  ScheduleResponse,
  ScheduleRun,
  ScheduledRow,
  TimeSlot,
} from "../types";

type Filters = {
  source: string;
  query: string;
  issue: string;
  classType: string;
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

type QuickFixTarget = {
  key: string;
  conflictId?: number | null;
  sessionId?: number | null;
};

type ConflictSeverityFilter = "all" | "hard" | "soft";
type RowIssueState = { hard: boolean; soft: boolean };

const emptyFilters: Filters = {
  source: "",
  query: "",
  issue: "",
  classType: "",
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
  const [rooms, setRooms] = useSessionState<Room[]>("review.rooms", []);
  const [timeSlots, setTimeSlots] = useSessionState<TimeSlot[]>("review.timeSlots", []);
  const [filters, setFilters] = useSessionState<Filters>("review.filters", emptyFilters);
  const [moveDrafts, setMoveDrafts] = useSessionState<Record<number, MoveDraft>>("review.moveDrafts", {});
  const [savingMove, setSavingMove] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useSessionState<string | null>("review.error", null);
  const [activeSessionId, setActiveSessionId] = useSessionState<number | null>("review.activeSessionId", null);
  const [movingConflict, setMovingConflict] = useState(false);
  const [conflictTab, setConflictTab] = useSessionState<"modules" | "issues">("review.conflictTab", "modules");
  const [conflictSeverityFilter, setConflictSeverityFilter] = useSessionState<ConflictSeverityFilter>(
    "review.conflictSeverityFilter",
    "all",
  );
  const [quickFixOpenKey, setQuickFixOpenKey] = useState<string | null>(null);
  const [quickFixSuggestions, setQuickFixSuggestions] = useState<Record<string, QuickFixSuggestion[]>>({});
  const [quickFixErrors, setQuickFixErrors] = useState<Record<string, string>>({});
  const [quickFixLoading, setQuickFixLoading] = useState<string | null>(null);
  const [applyingQuickFix, setApplyingQuickFix] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const latest = await getLatestSchedule();
      setSchedule(latest);
      const [nextViolations, nextRuns, nextComparisons, nextRooms, nextTimeSlots] = await Promise.all([
        getViolations(latest.schedule_run.id),
        getScheduleRuns(),
        compareSchedules(),
        getRooms(),
        getTimeSlots(),
      ]);
      setViolations(nextViolations);
      setRuns(nextRuns);
      setComparisons(nextComparisons);
      setRooms(nextRooms);
      setTimeSlots(nextTimeSlots);
    } catch (err) {
      setSchedule(null);
      setViolations([]);
      setError(err instanceof Error ? err.message : "Could not load schedule");
    } finally {
      setLoading(false);
    }
  }, [setComparisons, setError, setRooms, setRuns, setSchedule, setTimeSlots, setViolations]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setQuickFixOpenKey(null);
    setQuickFixSuggestions({});
    setQuickFixErrors({});
    setQuickFixLoading(null);
    setApplyingQuickFix(null);
  }, [schedule?.schedule_run.id]);

  const rows = useMemo(() => schedule?.scheduled_sessions ?? [], [schedule]);
  const labRowCount = useMemo(() => rows.filter(isLabRequirement).length, [rows]);
  const uploadedRowCount = rows.length - labRowCount;
  const sourceCounts = useMemo(
    () => ({ all: rows.length, uploaded: uploadedRowCount, lab: labRowCount }),
    [labRowCount, rows.length, uploadedRowCount],
  );
  const issueBySessionId = useMemo(() => issueStateBySessionId(violations), [violations]);
  const issueCounts = useMemo(() => countIssueStates(rows, issueBySessionId), [issueBySessionId, rows]);
  const activeFilterCount = useMemo(() => Object.values(filters).filter(Boolean).length, [filters]);
  const filteredRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          matchesSource(row, filters.source) &&
          matchesSearch(row, filters.query) &&
          matchesIssue(row, filters.issue, issueBySessionId) &&
          matches(row.class_type, filters.classType) &&
          matches(row.programme, filters.programme) &&
          matches(row.student_group_code, filters.group) &&
          matchesStaff(row, filters.staff) &&
          matches(row.room, filters.room) &&
          matches(row.day, filters.day),
      ),
    [filters, issueBySessionId, rows],
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

  const { availableSlotKeys, softAvailableSlotKeys, blockedSlotKeys } = useMemo(() => {
    const available = new Set<string>();
    const softAvailable = new Set<string>();
    const blocked = new Set<string>();
    if (!activeSessionId)
      return { availableSlotKeys: available, softAvailableSlotKeys: softAvailable, blockedSlotKeys: blocked };

    const targetRow = rows.find((r) => r.session_id === activeSessionId);
    if (!targetRow)
      return { availableSlotKeys: available, softAvailableSlotKeys: softAvailable, blockedSlotKeys: blocked };

    const draft = moveDrafts[activeSessionId];
    const targetRoom = draft?.room_code || targetRow.room;
    const rowDuration = timeToMinutes(targetRow.end_time) - timeToMinutes(targetRow.start_time);
    const candidateSlots = timeSlots.filter(
      (slot) => slot.duration_minutes === rowDuration && slot.week_pattern === targetRow.week_pattern,
    );

    for (const slot of candidateSlots) {
      const key = slotDisplayKey(slot.day, slot.start_time);
      if (isSamePlacement(targetRow, targetRoom, slot.day, slot.start_time, slot.end_time)) {
        continue;
      }
      if (hasHardPlacementConflict(targetRow, rows, targetRoom, slot.day, slot.start_time, slot.end_time)) {
        blocked.add(key);
        continue;
      }
      available.add(key);
      if (hasSoftPlacementWarning(targetRow, slot.day)) {
        softAvailable.add(key);
      }
    }

    return { availableSlotKeys: available, softAvailableSlotKeys: softAvailable, blockedSlotKeys: blocked };
  }, [activeSessionId, moveDrafts, rows, timeSlots]);

  const openRun = async (id: number) => {
    setError(null);
    try {
      const nextSchedule = await getSchedule(id);
      setSchedule(nextSchedule);
      setViolations(await getViolations(id));
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
      setComparisons(await compareSchedules());
      setMoveDrafts((current) => {
        const next = { ...current };
        delete next[row.session_id];
        return next;
      });
      notifyWorkflowProgressChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move scheduled session");
      setMoveDrafts((current) => {
        const next = { ...current };
        delete next[row.session_id];
        return next;
      });
    } finally {
      setSavingMove(null);
    }
  };

  const handleConflictMove = async (day: string, startTime: string) => {
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
        room_code: moveDrafts[activeSessionId]?.room_code || targetRow.room,
      });
      const refreshed = await getSchedule(schedule.schedule_run.id);
      setSchedule(refreshed);
      const newViolations = await getViolations(schedule.schedule_run.id);
      setViolations(newViolations);
      setComparisons(await compareSchedules());
      setMoveDrafts((current) => {
        const next = { ...current };
        delete next[activeSessionId];
        return next;
      });
      setActiveSessionId(null);
      notifyWorkflowProgressChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move session");
      setMoveDrafts((current) => {
        const next = { ...current };
        delete next[activeSessionId];
        return next;
      });
    } finally {
      setMovingConflict(false);
    }
  };

  const toggleQuickFix = async (target: QuickFixTarget) => {
    if (!schedule) return;
    if (quickFixOpenKey === target.key) {
      setQuickFixOpenKey(null);
      return;
    }

    setQuickFixOpenKey(target.key);
    if (quickFixSuggestions[target.key] || quickFixLoading === target.key) return;

    setQuickFixLoading(target.key);
    setQuickFixErrors((current) => {
      const next = { ...current };
      delete next[target.key];
      return next;
    });
    try {
      const result = await suggestScheduleFixes(schedule.schedule_run.id, {
        conflict_id: target.conflictId,
        session_id: target.sessionId,
      });
      setQuickFixSuggestions((current) => ({ ...current, [target.key]: result.suggestions }));
    } catch (err) {
      setQuickFixErrors((current) => ({
        ...current,
        [target.key]: err instanceof Error ? err.message : "Could not load quick fixes",
      }));
    } finally {
      setQuickFixLoading(null);
    }
  };

  const applyQuickFix = async (key: string, suggestion: QuickFixSuggestion, index: number) => {
    if (!schedule) return;
    const applyKey = `${key}-${index}`;
    setApplyingQuickFix(applyKey);
    setError(null);
    try {
      await moveScheduledSession(schedule.schedule_run.id, suggestion.session_id, {
        day: suggestion.day,
        start_time: suggestion.start_time,
        end_time: suggestion.end_time,
        room_code: suggestion.room_code,
      });
      const [refreshed, nextViolations, nextComparisons] = await Promise.all([
        getSchedule(schedule.schedule_run.id),
        getViolations(schedule.schedule_run.id),
        compareSchedules(),
      ]);
      setSchedule(refreshed);
      setViolations(nextViolations);
      setComparisons(nextComparisons);
      setActiveSessionId(null);
      setQuickFixOpenKey(null);
      notifyWorkflowProgressChange();
      setQuickFixSuggestions((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    } catch (err) {
      setQuickFixErrors((current) => ({
        ...current,
        [key]: err instanceof Error ? err.message : "Could not apply quick fix",
      }));
    } finally {
      setApplyingQuickFix(null);
    }
  };

  const renderQuickFixTray = (key: string) => {
    const suggestions = quickFixSuggestions[key] ?? [];
    const loading = quickFixLoading === key;
    const errorText = quickFixErrors[key];

    return (
      <div className="quick-fix-tray">
        <div className="quick-fix-heading">
          <Zap size={16} />
          <strong>Suggested Clash-Free Fixes</strong>
        </div>
        {loading && (
          <div className="quick-fix-loading">
            <div />
            <div />
            <div />
          </div>
        )}
        {errorText && <div className="notice bad">{errorText}</div>}
        {!loading && !errorText && suggestions.length === 0 && (
          <div className="empty-state">No clean quick fixes were found for this placement.</div>
        )}
        {suggestions.length > 0 && (
          <div className="quick-fix-list">
            {suggestions.map((suggestion, index) => {
              const applyKey = `${key}-${index}`;
              const applying = applyingQuickFix === applyKey;
              return (
                <article
                  className="quick-fix-card"
                  key={`${suggestion.type}-${suggestion.room_code}-${suggestion.new_time}`}
                >
                  <div>
                    <span>{quickFixTypeLabel(suggestion.type)}</span>
                    <strong>{suggestion.description}</strong>
                  </div>
                  <button
                    className="button slim"
                    type="button"
                    disabled={Boolean(applyingQuickFix) || loading}
                    onClick={() => void applyQuickFix(key, suggestion, index)}
                  >
                    {applying ? <RefreshCw className="spin" size={14} /> : null}
                    {applying ? "Applying" : "Apply This Fix"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const hardConflictCount = useMemo(
    () => violations.filter((violation) => violation.severity === "HARD").length,
    [violations],
  );
  const softConflictCount = useMemo(
    () => violations.filter((violation) => violation.severity === "SOFT").length,
    [violations],
  );
  const currentQuality = schedule?.schedule_run.quality;

  const visibleViolations = useMemo(() => {
    if (conflictSeverityFilter === "hard") return violations.filter((violation) => violation.severity === "HARD");
    if (conflictSeverityFilter === "soft") return violations.filter((violation) => violation.severity === "SOFT");
    return violations;
  }, [conflictSeverityFilter, violations]);

  const conflictSessionIds = useMemo(() => {
    const ids = new Set<number>();
    for (const violation of visibleViolations) {
      for (const id of violation.affected_session_ids) ids.add(id);
    }
    return ids;
  }, [visibleViolations]);

  const conflictSessions = useMemo(() => {
    const sessions = rows.filter((r) => conflictSessionIds.has(r.session_id));
    return sessions.sort((a, b) => {
      const aHasHard = visibleViolations.some(
        (v) => v.severity === "HARD" && v.affected_session_ids.includes(a.session_id),
      );
      const bHasHard = visibleViolations.some(
        (v) => v.severity === "HARD" && v.affected_session_ids.includes(b.session_id),
      );
      if (aHasHard && !bHasHard) return -1;
      if (!aHasHard && bHasHard) return 1;
      return 0;
    });
  }, [rows, conflictSessionIds, visibleViolations]);

  const conflictSessionGroups = useMemo(() => {
    const hardRows: ScheduledRow[] = [];
    const softRows: ScheduledRow[] = [];
    conflictSessions.forEach((row) => {
      const rowViolations = visibleViolations.filter((violation) =>
        violation.affected_session_ids.includes(row.session_id),
      );
      if (rowViolations.some((violation) => violation.severity === "HARD")) {
        hardRows.push(row);
        return;
      }
      if (rowViolations.length > 0) softRows.push(row);
    });

    return [
      {
        key: "hard" as const,
        label: "Hard Constraints",
        hint: "Must be fixed before export",
        rows: hardRows,
        issueCount: countUniqueGroupIssues(hardRows, visibleViolations),
      },
      {
        key: "soft" as const,
        label: "Soft Constraints",
        hint: "Optional quality warnings",
        rows: softRows,
        issueCount: countUniqueGroupIssues(softRows, visibleViolations),
      },
    ].filter((group) => group.rows.length > 0);
  }, [conflictSessions, visibleViolations]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Review Timetable</h1>
          <p>Inspect and adjust the generated timetable</p>
        </div>
        <div className="toolbar-row">
          <button className="button secondary" onClick={load} disabled={loading}>
            <RefreshCw className={loading ? "spin" : ""} size={17} />
            Refresh
          </button>
        </div>
      </div>
      {error && <div className="notice bad">{error}</div>}

      {loading ? (
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
                {currentQuality && (
                  <div className="optimised-score-control">
                    <StatusBadge
                      label={`Optimised score: ${currentQuality.score}/100 ${currentQuality.label}`}
                      tone={currentQuality.tone}
                    />
                    <OptimisedScoreInfo quality={currentQuality} />
                  </div>
                )}
                <span>{filteredRows.length} sessions shown</span>
                <span>{labRowCount} lab requirement sessions</span>
                <span>{violations.length} issues</span>
                {currentQuality && <span>{currentQuality.soft_warning_count} soft warnings</span>}
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
                      <th>Soft Warnings</th>
                      <th>Optimised Score</th>
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
                        <td>{run.quality?.soft_warning_count ?? run.stored_soft_issues}</td>
                        <td>
                          <StatusBadge
                            label={`${run.quality?.score ?? run.quality_score}/100 ${run.quality?.label ?? ""}`.trim()}
                            tone={run.quality?.tone ?? "neutral"}
                          />
                        </td>
                        <td>
                          <div className="table-actions">
                            <button className="button secondary slim" type="button" onClick={() => openRun(run.id)}>
                              Review
                            </button>
                            <a
                              className="button secondary slim"
                              href={`#run-report/${run.id}`}
                              rel="noopener noreferrer"
                              target="_blank"
                            >
                              <FileText size={14} />
                              View Report
                            </a>
                          </div>
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
            <div className="filter-bar review-filter-bar">
              <div className="review-filter-icon">
                <Filter size={18} />
              </div>
              <SourceFilterTabs
                counts={sourceCounts}
                value={filters.source}
                onChange={(value) => setFilters({ ...filters, source: value })}
              />
              <label className="review-search-filter">
                <span>Search</span>
                <input
                  placeholder="Module, requirement, staff, room, group"
                  type="search"
                  value={filters.query}
                  onChange={(event) => setFilters({ ...filters, query: event.target.value })}
                />
              </label>
              <label>
                <span>Issue Status</span>
                <select
                  value={filters.issue}
                  onChange={(event) => setFilters({ ...filters, issue: event.target.value })}
                >
                  <option value="">All ({rows.length})</option>
                  <option value="any">Has issues ({issueCounts.any})</option>
                  <option value="hard">Hard conflicts ({issueCounts.hard})</option>
                  <option value="soft">Soft warnings ({issueCounts.soft})</option>
                  <option value="clean">Clean ({issueCounts.clean})</option>
                </select>
              </label>
              <FilterSelect
                label="Class Type"
                value={filters.classType}
                values={unique(rows, "class_type")}
                onChange={(value) => setFilters({ ...filters, classType: value })}
              />
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
              <div className="review-filter-summary">
                Showing <strong>{filteredRows.length}</strong> of <strong>{rows.length}</strong> sessions
                {activeFilterCount > 0 ? (
                  <span>
                    {activeFilterCount} active filter{activeFilterCount === 1 ? "" : "s"}
                  </span>
                ) : (
                  <span>No active filters</span>
                )}
              </div>
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
              softAvailableSlotKeys={softAvailableSlotKeys}
              blockedSlotKeys={blockedSlotKeys}
              onClickAvailableSlot={handleConflictMove}
              onBlockedSlot={(message) => setError(message)}
              onSelectSession={(sessionId) => setActiveSessionId(sessionId)}
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
                  {hardConflictCount > 0 ? (
                    <strong style={{ color: "#dc2626" }}>
                      ⚠️ {hardConflictCount} Hard Conflict{hardConflictCount === 1 ? "" : "s"} remaining. Fix them to
                      unlock export.
                    </strong>
                  ) : violations.length > 0 ? (
                    <span style={{ color: "#f97316" }}>Soft warnings remain optional. Export is unlocked.</span>
                  ) : (
                    <span className="muted">🎉 All hard conflicts resolved! Timetable is ready for export.</span>
                  )}
                </p>
              </div>
              <div className="conflict-panel-toolbar">
                <div className="conflict-view-tabs">
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
                </div>
                <div className="conflict-severity-filter" aria-label="Filter conflicts by severity">
                  {[
                    { key: "all" as const, label: "All", count: violations.length },
                    { key: "hard" as const, label: "Hard", count: hardConflictCount },
                    { key: "soft" as const, label: "Soft", count: softConflictCount },
                  ].map((option) => (
                    <button
                      aria-pressed={conflictSeverityFilter === option.key}
                      className={`conflict-severity-button ${option.key} ${
                        conflictSeverityFilter === option.key ? "active" : ""
                      }`}
                      key={option.key}
                      onClick={() => setConflictSeverityFilter(option.key)}
                      type="button"
                    >
                      <span>{option.label}</span>
                      <strong>{option.count}</strong>
                    </button>
                  ))}
                </div>
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
                <span className="green-label">green slot</span> or <span className="amber-label">amber slot</span> on
                the timetable to move it.
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
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conflictSessionGroups.map((group) => (
                      <Fragment key={group.key}>
                        <tr className={`conflict-group-row ${group.key}`}>
                          <td colSpan={7}>
                            <div>
                              <strong>{group.label}</strong>
                              <span>
                                {group.rows.length} module{group.rows.length === 1 ? "" : "s"} | {group.issueCount}{" "}
                                issue
                                {group.issueCount === 1 ? "" : "s"} | {group.hint}
                              </span>
                            </div>
                          </td>
                        </tr>
                        {group.rows.map((row) => {
                          const rowViolations = visibleViolations.filter((v) =>
                            v.affected_session_ids.includes(row.session_id),
                          );
                          const isActive = activeSessionId === row.session_id;
                          const hasHard = rowViolations.some((v) => v.severity === "HARD");
                          const quickFixKey = `session-${row.session_id}`;
                          const quickFixOpen = quickFixOpenKey === quickFixKey;
                          const resolvingClass = applyingQuickFix?.startsWith(`${quickFixKey}-`)
                            ? "quick-fix-resolving"
                            : "";
                          const urgencyClass = hasHard ? "conflict-hard-row" : "conflict-soft-row";
                          return (
                            <Fragment key={row.session_id}>
                              <tr
                                className={`${urgencyClass} ${resolvingClass} ${isActive ? "conflict-active-row" : ""}`}
                                onClick={() => setActiveSessionId(row.session_id)}
                                style={{ cursor: "pointer" }}
                              >
                                <td>{row.programme || `Req-${row.session_id}`}</td>
                                <td>{row.student_group_code}</td>
                                <td>{row.staff_name}</td>
                                <td>
                                  {row.day} {row.start_time}-{row.end_time}
                                </td>
                                <td>{row.room}</td>
                                <td>
                                  {rowViolations.length} {group.key} issue{rowViolations.length === 1 ? "" : "s"}
                                </td>
                                <td>
                                  <button
                                    className={`button secondary slim quick-fix-toggle ${quickFixOpen ? "open" : ""}`}
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void toggleQuickFix({ key: quickFixKey, sessionId: row.session_id });
                                    }}
                                  >
                                    <Zap size={14} />
                                    Quick Fix
                                    <ChevronDown size={14} />
                                  </button>
                                </td>
                              </tr>
                              {quickFixOpen && (
                                <tr className="quick-fix-row">
                                  <td colSpan={7}>{renderQuickFixTray(quickFixKey)}</td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    ))}
                    {conflictSessionGroups.length === 0 && (
                      <tr>
                        <td colSpan={7}>No modules match the selected conflict filter.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <ConflictTable
                violations={visibleViolations}
                activeConflictId={null}
                quickFixOpenId={
                  quickFixOpenKey?.startsWith("conflict-") ? Number(quickFixOpenKey.replace("conflict-", "")) : null
                }
                resolvingConflictId={
                  applyingQuickFix?.startsWith("conflict-") ? Number(applyingQuickFix.split("-")[1]) : null
                }
                onSelectConflict={(v) => setActiveSessionId(v?.affected_session_ids[0] ?? null)}
                onToggleQuickFix={(violation) =>
                  void toggleQuickFix({ key: `conflict-${violation.id}`, conflictId: violation.id })
                }
                renderQuickFixTray={(violation) => renderQuickFixTray(`conflict-${violation.id}`)}
              />
            )}
          </section>
          <section className="status-card review-report-cta">
            <div className="review-report-copy">
              <div className="review-report-icon">
                <FileText size={20} />
              </div>
              <div>
                <div className="status-card-title">Timetable Run Report</div>
                <p>Open the full scheduling breakdown, resource workload, conflicts, and session appendix.</p>
              </div>
            </div>
            <a
              className="button"
              href={`#run-report/${schedule.schedule_run.id}`}
              rel="noopener noreferrer"
              target="_blank"
            >
              <FileText size={17} />
              View Full Report
            </a>
          </section>
        </>
      )}
    </div>
  );
}

function SourceFilterTabs({
  counts,
  value,
  onChange,
}: {
  counts: { all: number; uploaded: number; lab: number };
  value: string;
  onChange: (value: string) => void;
}) {
  const options = [
    { key: "", label: "All", count: counts.all },
    { key: "uploaded", label: "Uploaded", count: counts.uploaded },
    { key: "lab", label: "Lab requirements", count: counts.lab },
  ];
  return (
    <div className="review-source-tabs" aria-label="Source filter" role="group">
      {options.map((option) => (
        <button
          aria-pressed={value === option.key}
          className={`review-source-tab ${value === option.key ? "active" : ""}`}
          key={option.key || "all"}
          onClick={() => onChange(option.key)}
          type="button"
        >
          <span>{option.label}</span>
          <strong>{option.count}</strong>
        </button>
      ))}
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
  return Array.from(new Set(rows.flatMap(staffLabels).filter(Boolean).map(String))).sort();
}

function countUniqueGroupIssues(rows: ScheduledRow[], violations: ConstraintViolation[]) {
  const sessionIds = new Set(rows.map((row) => row.session_id));
  return violations.filter((violation) => violation.affected_session_ids.some((id) => sessionIds.has(id))).length;
}

function slotDisplayKey(day: string, startTime: string) {
  return `${day}|${startTime}|${minutesToTime(timeToMinutes(startTime) + 60)}`;
}

function minutesToTime(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function isSamePlacement(row: ScheduledRow, roomCode: string, day: string, startTime: string, endTime: string) {
  return row.room === roomCode && row.day === day && row.start_time === startTime && row.end_time === endTime;
}

function hasHardPlacementConflict(
  targetRow: ScheduledRow,
  rows: ScheduledRow[],
  roomCode: string,
  day: string,
  startTime: string,
  endTime: string,
) {
  const targetStaffTokens = staffTokens(targetRow);
  return rows.some((row) => {
    if (row.session_id === targetRow.session_id) return false;
    if (row.day !== day) return false;
    if (!weekPatternsOverlap(row.week_pattern, targetRow.week_pattern)) return false;
    if (!intervalsOverlap(startTime, endTime, row.start_time, row.end_time)) return false;

    const sameRoom = normalizeToken(row.room) === normalizeToken(roomCode);
    const sameGroup =
      Boolean(row.student_group_code) &&
      normalizeToken(row.student_group_code) === normalizeToken(targetRow.student_group_code);
    const sameStaff = staffTokens(row).some((token) => targetStaffTokens.includes(token));
    return sameRoom || sameGroup || sameStaff;
  });
}

function hasSoftPlacementWarning(row: ScheduledRow, day: string) {
  const deliveryMode = normalizeToken(row.delivery_mode);
  return deliveryMode.includes("online") && !["monday", "tuesday"].includes(normalizeToken(day));
}

function staffTokens(row: ScheduledRow) {
  return [row.staff_id, row.staff_name, row.co_teacher_ids, row.co_teacher_names]
    .flatMap(splitTokens)
    .map(normalizeToken)
    .filter(Boolean);
}

function splitTokens(value: string | null | undefined) {
  return value ? value.split(",").map((item) => item.trim()) : [];
}

function staffLabels(row: ScheduledRow) {
  return [row.staff_name, row.co_teacher_names].flatMap(splitTokens).filter(Boolean);
}

function weekPatternsOverlap(left: string | null, right: string | null) {
  const leftPattern = normalizeToken(left || "Weekly");
  const rightPattern = normalizeToken(right || "Weekly");
  return leftPattern === "weekly" || rightPattern === "weekly" || leftPattern === rightPattern;
}

function normalizeToken(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function quickFixTypeLabel(type: QuickFixSuggestion["type"]) {
  if (type === "VENUE_CHANGE") return "Venue priority";
  if (type === "TIME_CHANGE") return "Time priority";
  return "Alternative best";
}

function matches(value: string | null, filter: string) {
  return !filter || value === filter;
}

function isLabRequirement(row: ScheduledRow) {
  return row.is_lab_requirement === true || (row.requirement_id ?? "").startsWith("LAB-");
}

function matchesSource(row: ScheduledRow, filter: string) {
  if (filter === "lab") return isLabRequirement(row);
  if (filter === "uploaded") return !isLabRequirement(row);
  return true;
}

function matchesSearch(row: ScheduledRow, query: string) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [
    row.requirement_id,
    row.programme,
    row.module_code,
    row.class_type,
    row.student_group_code,
    row.staff_name,
    row.staff_id,
    row.co_teacher_names,
    row.co_teacher_ids,
    row.room,
    row.day,
    row.start_time,
    row.end_time,
    row.week_pattern,
    row.custom_weeks,
    row.delivery_mode,
    row.campus_mode,
    row.source_file,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function matchesStaff(row: ScheduledRow, filter: string) {
  if (!filter) return true;
  return staffLabels(row).some((label) => label === filter);
}

function matchesIssue(row: ScheduledRow, filter: string, issueBySessionId: Map<number, RowIssueState>) {
  if (!filter) return true;
  const issue = issueBySessionId.get(row.session_id);
  const hasHard = issue?.hard === true;
  const hasSoft = issue?.soft === true;
  if (filter === "hard") return hasHard;
  if (filter === "soft") return hasSoft;
  if (filter === "any") return hasHard || hasSoft;
  if (filter === "clean") return !hasHard && !hasSoft;
  return true;
}

function issueStateBySessionId(violations: ConstraintViolation[]) {
  const states = new Map<number, RowIssueState>();
  for (const violation of violations) {
    for (const sessionId of violation.affected_session_ids) {
      const current = states.get(sessionId) ?? { hard: false, soft: false };
      if (violation.severity === "HARD") current.hard = true;
      if (violation.severity === "SOFT") current.soft = true;
      states.set(sessionId, current);
    }
  }
  return states;
}

function countIssueStates(rows: ScheduledRow[], issueBySessionId: Map<number, RowIssueState>) {
  return rows.reduce(
    (counts, row) => {
      const issue = issueBySessionId.get(row.session_id);
      const hasHard = issue?.hard === true;
      const hasSoft = issue?.soft === true;
      if (hasHard) counts.hard += 1;
      if (hasSoft) counts.soft += 1;
      if (hasHard || hasSoft) counts.any += 1;
      else counts.clean += 1;
      return counts;
    },
    { any: 0, hard: 0, soft: 0, clean: 0 },
  );
}
