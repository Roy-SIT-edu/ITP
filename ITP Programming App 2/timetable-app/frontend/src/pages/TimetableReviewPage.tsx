/*
 * Review page.
 * Displays the latest generated timetable and any stored constraint violations.
 */

import {
  ArrowUpDown,
  BookOpenCheck,
  ChevronDown,
  FileText,
  Filter,
  History,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Zap,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  compareSchedules,
  getLatestSchedule,
  getQuickFixAvailability,
  getRooms,
  getSchedule,
  getScheduleExplanations,
  getScheduleRuns,
  getTimeSlots,
  getViolations,
  moveScheduledSession,
  suggestScheduleFixes,
  autoDeconflict,
} from "../api/client";
import AutoDeconflictStatus from "../components/AutoDeconflictStatus";
import ConflictTable, { type QuickFixState } from "../components/ConflictTable";
import InlineActivity from "../components/InlineActivity";
import OptimisedScoreInfo from "../components/OptimisedScoreInfo";
import StatusBadge from "../components/StatusBadge";
import TimetableGrid from "../components/TimetableGrid";
import { notifyWorkflowProgressChange } from "../components/WorkflowProgress";
import { intervalsOverlap, timeToMinutes } from "../components/timetable/timetableUtils";
import { conflictPresentation, uniqueConflictTypes } from "../conflictPresentation";
import { useSessionState } from "../sessionState";
import type {
  ConstraintViolation,
  QuickFixAvailability,
  QuickFixSuggestion,
  Room,
  ScheduleComparison,
  ScheduleExplanation,
  ScheduleGenerateResult,
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
type ConflictSort = "priority" | "type" | "class" | "time";
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
  const [explanations, setExplanations] = useSessionState<ScheduleExplanation[]>("review.explanations", []);
  const [rooms, setRooms] = useSessionState<Room[]>("review.rooms", []);
  const [timeSlots, setTimeSlots] = useSessionState<TimeSlot[]>("review.timeSlots", []);
  const [filters, setFilters] = useSessionState<Filters>("review.filters", emptyFilters);
  const [moveDrafts, setMoveDrafts] = useSessionState<Record<number, MoveDraft>>("review.moveDrafts", {});
  const [savingMove, setSavingMove] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useSessionState<string | null>("review.error", null);
  const [activeSessionId, setActiveSessionId] = useSessionState<number | null>("review.activeSessionId", null);
  const [movingConflict, setMovingConflict] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [conflictTab, setConflictTab] = useSessionState<"modules" | "issues">("review.conflictTab", "modules");
  const [conflictSeverityFilter, setConflictSeverityFilter] = useSessionState<ConflictSeverityFilter>(
    "review.conflictSeverityFilter",
    "all",
  );
  const [constraintTypeFilter, setConstraintTypeFilter] = useSessionState<string>("review.constraintTypeFilter", "all");
  const [conflictSort, setConflictSort] = useSessionState<ConflictSort>("review.conflictSort", "priority");
  const [quickFixOpenKey, setQuickFixOpenKey] = useState<string | null>(null);
  const [quickFixAvailability, setQuickFixAvailability] = useState<QuickFixAvailability | null>(null);
  const [quickFixAvailabilityStatus, setQuickFixAvailabilityStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [quickFixAvailabilityRefresh, setQuickFixAvailabilityRefresh] = useState(0);
  const [quickFixSuggestions, setQuickFixSuggestions] = useState<Record<string, QuickFixSuggestion[]>>({});
  const [quickFixErrors, setQuickFixErrors] = useState<Record<string, string>>({});
  const [quickFixLoading, setQuickFixLoading] = useState<string | null>(null);
  const [applyingQuickFix, setApplyingQuickFix] = useState<string | null>(null);
  const [deconflicting, setDeconflicting] = useState(false);
  const [deconflictStartedAt, setDeconflictStartedAt] = useState<number | null>(null);
  const [deconflictElapsedSeconds, setDeconflictElapsedSeconds] = useState(0);
  const [deconflictResult, setDeconflictResult] = useState<ScheduleGenerateResult | null>(null);

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
      setExplanations([]);
      setError(err instanceof Error ? err.message : "Could not load schedule");
    } finally {
      setLoading(false);
    }
  }, [setComparisons, setError, setExplanations, setRooms, setRuns, setSchedule, setTimeSlots, setViolations]);

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

  useEffect(() => {
    const scheduleRunId = schedule?.schedule_run.id;
    if (!scheduleRunId) {
      setQuickFixAvailability(null);
      setQuickFixAvailabilityStatus("idle");
      return;
    }

    let cancelled = false;
    setQuickFixAvailability(null);
    setQuickFixAvailabilityStatus("loading");
    void getQuickFixAvailability(scheduleRunId)
      .then((availability) => {
        if (!cancelled) {
          setQuickFixAvailability(availability);
          setQuickFixAvailabilityStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQuickFixAvailability(null);
          setQuickFixAvailabilityStatus("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [quickFixAvailabilityRefresh, schedule?.schedule_run.id]);

  useEffect(() => {
    if (deconflictStartedAt === null) return;
    const updateElapsed = () => setDeconflictElapsedSeconds((Date.now() - deconflictStartedAt) / 1000);
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [deconflictStartedAt]);

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
    setDeconflictResult(null);
    try {
      const [nextSchedule, nextViolations, nextExplanations] = await Promise.all([
        getSchedule(id),
        getViolations(id),
        getScheduleExplanations(id),
      ]);
      setSchedule(nextSchedule);
      setViolations(nextViolations);
      setExplanations(nextExplanations);
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
      const [refreshed, nextViolations, nextExplanations, nextComparisons] = await Promise.all([
        getSchedule(schedule.schedule_run.id),
        getViolations(schedule.schedule_run.id),
        getScheduleExplanations(schedule.schedule_run.id),
        compareSchedules(),
      ]);
      setSchedule(refreshed);
      setViolations(nextViolations);
      setExplanations(nextExplanations);
      setComparisons(nextComparisons);
      setQuickFixAvailabilityRefresh((current) => current + 1);
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
      const [refreshed, newViolations, nextExplanations, nextComparisons] = await Promise.all([
        getSchedule(schedule.schedule_run.id),
        getViolations(schedule.schedule_run.id),
        getScheduleExplanations(schedule.schedule_run.id),
        compareSchedules(),
      ]);
      setSchedule(refreshed);
      setViolations(newViolations);
      setExplanations(nextExplanations);
      setComparisons(nextComparisons);
      setQuickFixAvailabilityRefresh((current) => current + 1);
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
      const [refreshed, nextViolations, nextExplanations, nextComparisons] = await Promise.all([
        getSchedule(schedule.schedule_run.id),
        getViolations(schedule.schedule_run.id),
        getScheduleExplanations(schedule.schedule_run.id),
        compareSchedules(),
      ]);
      setSchedule(refreshed);
      setViolations(nextViolations);
      setExplanations(nextExplanations);
      setComparisons(nextComparisons);
      setQuickFixAvailabilityRefresh((current) => current + 1);
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

  const handleAutoDeconflict = async () => {
    if (!schedule) return;
    setDeconflicting(true);
    setDeconflictStartedAt(Date.now());
    setDeconflictElapsedSeconds(0);
    setDeconflictResult(null);
    setError(null);
    try {
      const result = await autoDeconflict(schedule.schedule_run.id);
      await load();
      setDeconflictResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auto deconflict failed");
    } finally {
      setDeconflicting(false);
      setDeconflictStartedAt(null);
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

  const constraintTypeOptions = useMemo(() => {
    const counts = new Map<string, { count: number; violation: ConstraintViolation }>();
    for (const violation of violations) {
      const current = counts.get(violation.constraint_code);
      counts.set(violation.constraint_code, {
        count: (current?.count ?? 0) + 1,
        violation,
      });
    }
    return Array.from(counts.entries())
      .map(([code, value]) => ({
        code,
        count: value.count,
        label: conflictPresentation(value.violation).label,
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [violations]);

  const rowsBySessionId = useMemo(() => new Map(rows.map((row) => [row.session_id, row])), [rows]);

  const visibleViolations = useMemo(() => {
    const filtered = violations.filter((violation) => {
      if (conflictSeverityFilter === "hard" && violation.severity !== "HARD") return false;
      if (conflictSeverityFilter === "soft" && violation.severity !== "SOFT") return false;
      return constraintTypeFilter === "all" || violation.constraint_code === constraintTypeFilter;
    });

    return filtered.sort((left, right) => {
      if (conflictSort === "type") {
        return conflictPresentation(left).label.localeCompare(conflictPresentation(right).label) || left.id - right.id;
      }

      const leftRow = rowsBySessionId.get(left.affected_session_ids[0]);
      const rightRow = rowsBySessionId.get(right.affected_session_ids[0]);
      if (conflictSort === "class") {
        return conflictRowLabel(leftRow).localeCompare(conflictRowLabel(rightRow)) || left.id - right.id;
      }
      if (conflictSort === "time") {
        return compareScheduledTimes(leftRow, rightRow) || left.id - right.id;
      }

      const severityDifference = severityRank(left.severity) - severityRank(right.severity);
      return severityDifference || conflictPresentation(left).label.localeCompare(conflictPresentation(right).label);
    });
  }, [conflictSeverityFilter, conflictSort, constraintTypeFilter, rowsBySessionId, violations]);

  const conflictSessionIds = useMemo(() => {
    const ids = new Set<number>();
    for (const violation of visibleViolations) {
      for (const id of violation.affected_session_ids) ids.add(id);
    }
    return ids;
  }, [visibleViolations]);

  const allConflictSessionCount = useMemo(() => {
    const ids = new Set<number>();
    violations.forEach((violation) => violation.affected_session_ids.forEach((id) => ids.add(id)));
    return ids.size;
  }, [violations]);

  const conflictSessions = useMemo(() => {
    const sessions = rows.filter((r) => conflictSessionIds.has(r.session_id));
    return sessions.sort((a, b) => {
      const aHasHard = visibleViolations.some(
        (v) => v.severity === "HARD" && v.affected_session_ids.includes(a.session_id),
      );
      const bHasHard = visibleViolations.some(
        (v) => v.severity === "HARD" && v.affected_session_ids.includes(b.session_id),
      );
      if (conflictSort === "class") return conflictRowLabel(a).localeCompare(conflictRowLabel(b));
      if (conflictSort === "time") {
        return compareScheduledTimes(a, b) || conflictRowLabel(a).localeCompare(conflictRowLabel(b));
      }

      const aTypes = visibleViolations.filter((violation) => violation.affected_session_ids.includes(a.session_id));
      const bTypes = visibleViolations.filter((violation) => violation.affected_session_ids.includes(b.session_id));
      if (conflictSort === "type") {
        const aLabel = aTypes.map((violation) => conflictPresentation(violation).label).sort()[0] ?? "";
        const bLabel = bTypes.map((violation) => conflictPresentation(violation).label).sort()[0] ?? "";
        return aLabel.localeCompare(bLabel) || conflictRowLabel(a).localeCompare(conflictRowLabel(b));
      }

      if (aHasHard && !bHasHard) return -1;
      if (!aHasHard && bHasHard) return 1;
      return bTypes.length - aTypes.length || conflictRowLabel(a).localeCompare(conflictRowLabel(b));
    });
  }, [rows, conflictSessionIds, conflictSort, visibleViolations]);

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

      {loading && !deconflicting ? (
        <InlineActivity
          kind="review"
          title="Preparing timetable review"
          steps={["Loading latest run", "Reading conflicts", "Building timetable view"]}
        />
      ) : null}

      <AutoDeconflictStatus
        running={deconflicting}
        elapsedSeconds={deconflictElapsedSeconds}
        result={deconflictResult}
      />

      {schedule && (
        <>
          <section className="status-card review-command-card">
            <div className="review-command-bar">
              <div className="review-run-identity">
                <span>Current schedule</span>
                <strong>Run {schedule.schedule_run.id}</strong>
                <StatusBadge
                  label={schedule.schedule_run.solver_status ?? schedule.schedule_run.status}
                  tone={schedule.schedule_run.hard_violation_count > 0 ? "bad" : "good"}
                />
              </div>
              <div className="review-command-metrics">
                {currentQuality && (
                  <div className="optimised-score-control">
                    <StatusBadge
                      label={`${currentQuality.score}/100 ${currentQuality.label}`}
                      tone={currentQuality.tone}
                    />
                    <OptimisedScoreInfo quality={currentQuality} />
                  </div>
                )}
                <span>{filteredRows.length} sessions</span>
                {labRowCount > 0 && <span>{labRowCount} labs</span>}
                <span className={hardConflictCount > 0 ? "review-metric-bad" : undefined}>
                  {hardConflictCount > 0 ? `${hardConflictCount} blocking` : `${softConflictCount} optional`}
                </span>
              </div>
              <div className="review-command-actions">
                <button
                  aria-expanded={versionsOpen}
                  className={`button secondary slim review-version-toggle ${versionsOpen ? "open" : ""}`}
                  onClick={() => setVersionsOpen((current) => !current)}
                  type="button"
                >
                  <History size={15} />
                  Versions
                  <span>{comparisons.length}</span>
                  <ChevronDown size={14} />
                </button>
                <button
                  className="button secondary slim"
                  disabled={loading || hardConflictCount === 0 || deconflicting}
                  onClick={handleAutoDeconflict}
                  type="button"
                >
                  <Sparkles size={15} />
                  Auto Deconflict
                </button>
                <a
                  className="button slim"
                  href={`#run-report/${schedule.schedule_run.id}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <FileText size={15} />
                  Full Report
                </a>
              </div>
            </div>
            {versionsOpen && (
              <div className="review-versions-panel">
                <div className="review-versions-heading">
                  <div>
                    <strong>Schedule Versions</strong>
                    <span>Compare recent generated runs</span>
                  </div>
                  {runs.length > comparisons.length && <span>{runs.length} total runs</span>}
                </div>
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
              </div>
            )}
          </section>
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
              <label className="review-filter-field review-search-filter">
                <span>Search</span>
                <input
                  placeholder="Module, requirement, staff, room, group"
                  type="search"
                  value={filters.query}
                  onChange={(event) => setFilters({ ...filters, query: event.target.value })}
                />
              </label>
              <label className="review-filter-field review-filter-field--issue">
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
                className="review-filter-field review-filter-field--class-type"
                label="Class Type"
                value={filters.classType}
                values={unique(rows, "class_type")}
                onChange={(value) => setFilters({ ...filters, classType: value })}
              />
              <FilterSelect
                className="review-filter-field review-filter-field--programme"
                label="Programme"
                value={filters.programme}
                values={unique(rows, "programme")}
                onChange={(value) => setFilters({ ...filters, programme: value })}
              />
              <FilterSelect
                className="review-filter-field review-filter-field--group"
                label="Group"
                value={filters.group}
                values={unique(rows, "student_group_code")}
                onChange={(value) => setFilters({ ...filters, group: value })}
              />
              <FilterSelect
                className="review-filter-field review-filter-field--staff"
                label="Staff"
                value={filters.staff}
                values={uniqueStaff(rows)}
                onChange={(value) => setFilters({ ...filters, staff: value })}
              />
              <FilterSelect
                className="review-filter-field review-filter-field--room"
                label="Room"
                value={filters.room}
                values={unique(rows, "room")}
                onChange={(value) => setFilters({ ...filters, room: value })}
              />
              <FilterSelect
                className="review-filter-field review-filter-field--day"
                label="Day"
                value={filters.day}
                values={unique(rows, "day")}
                onChange={(value) => setFilters({ ...filters, day: value })}
              />
              <button
                className="button secondary slim review-filter-clear"
                onClick={() => setFilters(emptyFilters)}
                type="button"
              >
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
                <div className="status-card-title">Schedule Health</div>
                <p>
                  {violations.length} issue{violations.length !== 1 ? "s" : ""} across {allConflictSessionCount}{" "}
                  affected class{allConflictSessionCount === 1 ? "" : "es"}.{" "}
                  {hardConflictCount > 0 ? (
                    <strong className="conflict-summary-hard">Resolve blocking issues before export.</strong>
                  ) : violations.length > 0 ? (
                    <span className="conflict-summary-soft">
                      Only optional improvements remain. Export is available.
                    </span>
                  ) : (
                    <span className="conflict-summary-clear">
                      No conflicts found. The timetable is ready for export.
                    </span>
                  )}
                </p>
              </div>
              <div className="conflict-panel-toolbar">
                <div className="conflict-view-tabs">
                  <button
                    className={`button slim ${conflictTab === "modules" ? "" : "secondary"}`}
                    onClick={() => setConflictTab("modules")}
                  >
                    Affected Classes
                  </button>
                  <button
                    className={`button slim ${conflictTab === "issues" ? "" : "secondary"}`}
                    onClick={() => setConflictTab("issues")}
                  >
                    Issue Details
                  </button>
                </div>
                {activeSessionId && (
                  <button className="button secondary slim" onClick={() => setActiveSessionId(null)}>
                    Clear Selection
                  </button>
                )}
              </div>
            </div>
            <div className="conflict-overview" aria-label="Conflict summary and filters">
              <button
                aria-pressed={conflictSeverityFilter === "all"}
                className={`conflict-overview-card all ${conflictSeverityFilter === "all" ? "active" : ""}`}
                onClick={() => setConflictSeverityFilter("all")}
                type="button"
              >
                <BookOpenCheck size={20} />
                <span>
                  <strong>{allConflictSessionCount}</strong>
                  <small>Affected classes</small>
                  <em>{violations.length} recorded issues</em>
                </span>
              </button>
              <button
                aria-pressed={conflictSeverityFilter === "hard"}
                className={`conflict-overview-card hard ${conflictSeverityFilter === "hard" ? "active" : ""}`}
                onClick={() => setConflictSeverityFilter("hard")}
                type="button"
              >
                <ShieldAlert size={20} />
                <span>
                  <strong>{hardConflictCount}</strong>
                  <small>Blocking issues</small>
                  <em>{hardConflictCount > 0 ? "Must fix before export" : "Nothing blocking export"}</em>
                </span>
              </button>
              <button
                aria-pressed={conflictSeverityFilter === "soft"}
                className={`conflict-overview-card soft ${conflictSeverityFilter === "soft" ? "active" : ""}`}
                onClick={() => setConflictSeverityFilter("soft")}
                type="button"
              >
                <Sparkles size={20} />
                <span>
                  <strong>{softConflictCount}</strong>
                  <small>Optional improvements</small>
                  <em>Improve quality when practical</em>
                </span>
              </button>
            </div>
            <div className="constraint-table-toolbar" aria-label="Constraint table controls">
              <div className="constraint-table-summary">
                <Filter size={18} />
                <div>
                  <strong>Constraint review</strong>
                  <span>
                    Showing {visibleViolations.length} of {violations.length} issue
                    {violations.length === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
              <div className="constraint-table-controls">
                <label>
                  <span>Constraint type</span>
                  <select
                    value={constraintTypeFilter}
                    onChange={(event) => setConstraintTypeFilter(event.target.value)}
                  >
                    <option value="all">All constraint types ({violations.length})</option>
                    {constraintTypeOptions.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.label} ({option.count})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Sort by</span>
                  <div className="constraint-sort-control">
                    <ArrowUpDown size={15} />
                    <select
                      value={conflictSort}
                      onChange={(event) => setConflictSort(event.target.value as ConflictSort)}
                    >
                      <option value="priority">Priority and issue count</option>
                      <option value="type">Constraint type A-Z</option>
                      <option value="class">Class A-Z</option>
                      <option value="time">Day and time</option>
                    </select>
                  </div>
                </label>
                {(constraintTypeFilter !== "all" ||
                  conflictSeverityFilter !== "all" ||
                  conflictSort !== "priority") && (
                  <button
                    className="button secondary slim constraint-reset-button"
                    onClick={() => {
                      setConstraintTypeFilter("all");
                      setConflictSeverityFilter("all");
                      setConflictSort("priority");
                    }}
                    type="button"
                  >
                    Reset
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
                <table className="constraint-class-table">
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th>Group</th>
                      <th>Staff</th>
                      <th>Current Time</th>
                      <th>Room</th>
                      <th>Why Flagged</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conflictSessionGroups.map((group) => (
                      <Fragment key={group.key}>
                        <tr className={`conflict-group-row ${group.key}`}>
                          <td colSpan={7}>
                            <div>
                              <strong>{group.key === "hard" ? "Needs attention" : "Optional improvements"}</strong>
                              <span>
                                {group.rows.length} class{group.rows.length === 1 ? "" : "es"} · {group.issueCount}{" "}
                                issue
                                {group.issueCount === 1 ? "" : "s"} · {group.hint}
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
                          const rowQuickFixState = resolveQuickFixState(
                            quickFixSuggestions[quickFixKey],
                            quickFixAvailability?.by_session_id[String(row.session_id)],
                            quickFixAvailabilityStatus,
                          );
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
                                <td>
                                  <strong>{row.module_code || row.requirement_id || `Class ${row.session_id}`}</strong>
                                  {row.programme && <small className="conflict-class-programme">{row.programme}</small>}
                                </td>
                                <td>{row.student_group_code}</td>
                                <td>{row.staff_name}</td>
                                <td>
                                  {row.day} {row.start_time}-{row.end_time}
                                </td>
                                <td>{row.room}</td>
                                <td>
                                  <div className="conflict-reason-list">
                                    {uniqueConflictTypes(rowViolations).map((violation) => {
                                      const presentation = conflictPresentation(violation);
                                      return (
                                        <span
                                          className={`conflict-reason-chip ${violation.severity.toLowerCase()}`}
                                          key={violation.constraint_code}
                                          title={presentation.explanation}
                                        >
                                          {presentation.label}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </td>
                                <td>
                                  <button
                                    className={`button secondary slim quick-fix-toggle ${quickFixOpen ? "open" : ""} ${rowQuickFixState}`}
                                    disabled={rowQuickFixState !== "available" && !quickFixOpen}
                                    title={quickFixButtonTitle(rowQuickFixState)}
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void toggleQuickFix({ key: quickFixKey, sessionId: row.session_id });
                                    }}
                                  >
                                    <Zap size={14} />
                                    {quickFixButtonLabel(rowQuickFixState)}
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
                quickFixState={(violation) => {
                  const key = `conflict-${violation.id}`;
                  return resolveQuickFixState(
                    quickFixSuggestions[key],
                    quickFixAvailability?.by_conflict_id[String(violation.id)],
                    quickFixAvailabilityStatus,
                  );
                }}
              />
            )}
          </section>
          <section className="status-card review-explanation-card">
            <div className="section-heading">
              <div>
                <div className="status-card-title">Why This Schedule?</div>
                <p>Placement explanations for the selected schedule run</p>
              </div>
            </div>
            <div className="explanation-grid compact">
              {explanations.slice(0, 4).map((item) => (
                <article className="explanation-card" key={item.session_id}>
                  <strong>{item.module_code ?? item.requirement_id ?? `Session ${item.session_id}`}</strong>
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
  className,
  label,
  value,
  values,
  onChange,
}: {
  className?: string;
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className={className}>
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

function resolveQuickFixState(
  cachedSuggestions: QuickFixSuggestion[] | undefined,
  available: boolean | undefined,
  status: "idle" | "loading" | "ready" | "error",
): QuickFixState {
  if (cachedSuggestions) return cachedSuggestions.length > 0 ? "available" : "unavailable";
  if (status === "error") return "error";
  if (status !== "ready") return "checking";
  return available === true ? "available" : "unavailable";
}

function quickFixButtonLabel(state: QuickFixState) {
  if (state === "unavailable") return "No Fix";
  if (state === "checking") return "Checking";
  if (state === "error") return "Unavailable";
  return "Quick Fix";
}

function quickFixButtonTitle(state: QuickFixState) {
  if (state === "unavailable") return "No clean quick fix is available";
  if (state === "checking") return "Checking for clean quick fixes";
  if (state === "error") return "Quick fix availability could not be checked";
  return undefined;
}

const conflictDayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function severityRank(severity: ConstraintViolation["severity"]) {
  return severity === "HARD" ? 0 : 1;
}

function conflictRowLabel(row: ScheduledRow | undefined) {
  return row?.module_code || row?.requirement_id || (row ? `Class ${row.session_id}` : "");
}

function compareScheduledTimes(left: ScheduledRow | undefined, right: ScheduledRow | undefined) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  const leftDay = conflictDayOrder.indexOf(left.day);
  const rightDay = conflictDayOrder.indexOf(right.day);
  const dayDifference = (leftDay === -1 ? 99 : leftDay) - (rightDay === -1 ? 99 : rightDay);
  return (
    dayDifference ||
    left.start_time.localeCompare(right.start_time) ||
    conflictRowLabel(left).localeCompare(conflictRowLabel(right))
  );
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
