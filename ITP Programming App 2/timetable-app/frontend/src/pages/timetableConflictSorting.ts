import { conflictPresentation } from "../conflictPresentation";
import type { ConstraintViolation, ScheduledRow } from "../types";

export type ConflictSort = "priority" | "type" | "class" | "group" | "staff" | "time" | "room";
export type SortDirection = "asc" | "desc";

const conflictDayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function sortConflictRows(
  rows: ScheduledRow[],
  violations: ConstraintViolation[],
  sort: ConflictSort,
  direction: SortDirection,
) {
  return [...rows].sort((left, right) => {
    const comparison = compareConflictRows(left, right, violations, sort);
    if (comparison !== 0) return direction === "asc" ? comparison : -comparison;
    return left.session_id - right.session_id;
  });
}

export function sortConflictViolations(
  violations: ConstraintViolation[],
  rowsBySessionId: Map<number, ScheduledRow>,
  sort: ConflictSort,
  direction: SortDirection,
) {
  return [...violations].sort((left, right) => {
    const comparison = compareConflictViolations(left, right, rowsBySessionId, sort);
    if (comparison !== 0) return direction === "asc" ? comparison : -comparison;
    return left.id - right.id;
  });
}

function compareConflictRows(
  left: ScheduledRow,
  right: ScheduledRow,
  violations: ConstraintViolation[],
  sort: ConflictSort,
) {
  const leftViolations = violationsForRow(left, violations);
  const rightViolations = violationsForRow(right, violations);

  if (sort === "priority") {
    const hardDifference = Number(hasHardViolation(rightViolations)) - Number(hasHardViolation(leftViolations));
    return (
      hardDifference ||
      rightViolations.length - leftViolations.length ||
      compareText(conflictRowLabel(left), conflictRowLabel(right))
    );
  }
  if (sort === "time") return compareScheduledTimes(left, right);

  return compareText(
    conflictRowSortValue(left, leftViolations, sort),
    conflictRowSortValue(right, rightViolations, sort),
  );
}

function compareConflictViolations(
  left: ConstraintViolation,
  right: ConstraintViolation,
  rowsBySessionId: Map<number, ScheduledRow>,
  sort: ConflictSort,
) {
  if (sort === "priority") {
    return (
      severityRank(left.severity) - severityRank(right.severity) ||
      compareText(conflictPresentation(left).label, conflictPresentation(right).label)
    );
  }
  if (sort === "type") {
    return compareText(conflictPresentation(left).label, conflictPresentation(right).label);
  }

  const leftRow = firstAffectedRow(left, rowsBySessionId);
  const rightRow = firstAffectedRow(right, rowsBySessionId);
  if (sort === "time") return compareScheduledTimes(leftRow, rightRow);

  return compareText(conflictRowSortValue(leftRow, [left], sort), conflictRowSortValue(rightRow, [right], sort));
}

function conflictRowSortValue(
  row: ScheduledRow | undefined,
  violations: ConstraintViolation[],
  sort: Exclude<ConflictSort, "priority" | "time">,
) {
  if (sort === "type") return firstIssueLabel(violations);
  if (sort === "class") return conflictRowLabel(row);
  if (sort === "group") return row?.student_group_code ?? "";
  if (sort === "staff") return row?.staff_name ?? "";
  return row?.room ?? "";
}

function violationsForRow(row: ScheduledRow, violations: ConstraintViolation[]) {
  return violations.filter((violation) => violation.affected_session_ids.includes(row.session_id));
}

function firstAffectedRow(violation: ConstraintViolation, rowsBySessionId: Map<number, ScheduledRow>) {
  for (const sessionId of violation.affected_session_ids) {
    const row = rowsBySessionId.get(sessionId);
    if (row) return row;
  }
  return undefined;
}

function firstIssueLabel(violations: ConstraintViolation[]) {
  return violations.map((violation) => conflictPresentation(violation).label).sort(compareText)[0] ?? "";
}

function hasHardViolation(violations: ConstraintViolation[]) {
  return violations.some((violation) => violation.severity === "HARD");
}

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
    compareText(conflictRowLabel(left), conflictRowLabel(right))
  );
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}
