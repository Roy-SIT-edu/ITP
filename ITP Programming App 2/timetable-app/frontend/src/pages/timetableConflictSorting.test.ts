import { describe, expect, it } from "vitest";
import type { ConstraintViolation, ScheduledRow } from "../types";
import { sortConflictRows, type ConflictSort } from "./timetableConflictSorting";

const rows = [
  scheduledRow(1, "BIO200", "G2", "Zoe", "Tuesday", "10:00", "Z-03"),
  scheduledRow(2, "ART100", "G3", "Amy", "Monday", "11:00", "A-01"),
  scheduledRow(3, "CHEM300", "G1", "Mia", "Monday", "09:00", "M-02"),
];

const violations: ConstraintViolation[] = [
  violation(1, "HARD", "STAFF_DOUBLE_BOOKING", 1),
  violation(2, "SOFT", "ROOM_DOUBLE_BOOKING", 2),
  violation(3, "SOFT", "TUTOR_IDLE_GAP", 3),
  violation(4, "SOFT", "SHORT_CAMPUS_DAY", 3),
];

describe("affected-class table sorting", () => {
  it.each([
    ["class", [2, 1, 3]],
    ["group", [3, 1, 2]],
    ["staff", [2, 3, 1]],
    ["time", [3, 2, 1]],
    ["room", [2, 3, 1]],
    ["type", [3, 2, 1]],
    ["priority", [1, 3, 2]],
  ] satisfies [ConflictSort, number[]][])("sorts rows by %s", (sort, expectedSessionIds) => {
    expect(sortConflictRows(rows, violations, sort, "asc").map((row) => row.session_id)).toEqual(expectedSessionIds);
  });

  it("reverses the selected column on descending sort", () => {
    expect(sortConflictRows(rows, violations, "class", "desc").map((row) => row.session_id)).toEqual([3, 1, 2]);
  });
});

function scheduledRow(
  sessionId: number,
  moduleCode: string,
  group: string,
  staff: string,
  day: string,
  startTime: string,
  room: string,
): ScheduledRow {
  return {
    scheduled_session_id: sessionId,
    session_id: sessionId,
    requirement_id: null,
    programme: null,
    year: null,
    module_code: moduleCode,
    class_type: null,
    student_group_code: group,
    staff_name: staff,
    staff_id: null,
    room,
    day,
    start_time: startTime,
    end_time: "12:00",
    start_week: null,
    end_week: null,
    week_pattern: "ALL",
    custom_weeks: null,
    delivery_mode: null,
    campus_mode: null,
  };
}

function violation(
  id: number,
  severity: ConstraintViolation["severity"],
  constraintCode: string,
  sessionId: number,
): ConstraintViolation {
  return {
    id,
    schedule_run_id: 1,
    constraint_code: constraintCode,
    severity,
    message: constraintCode,
    affected_session_ids: [sessionId],
  };
}
