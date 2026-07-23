import { describe, expect, it } from "vitest";
import type { ReportConflict } from "../types";
import { consolidateReportConflicts } from "./reportConflictGrouping";

describe("report conflict grouping", () => {
  it("groups constraints and merges duplicate messages with unique sessions", () => {
    const groups = consolidateReportConflicts([
      conflict(1, "SOFT", "LONG_CONSECUTIVE_DAY", "Long day on Wednesday.", [session(11, "CVE2151")]),
      conflict(2, "SOFT", "LONG_CONSECUTIVE_DAY", "Long day on Wednesday.", [
        session(11, "CVE2151"),
        session(12, "CVE2142"),
      ]),
      conflict(3, "SOFT", "LONG_CONSECUTIVE_DAY", "Long day on Thursday.", [session(13, "ICT1013")]),
      conflict(4, "HARD", "ROOM_DOUBLE_BOOKING", "Room overlap.", [session(14, "MEC1151")]),
    ]);

    expect(groups.map((group) => group.constraint_code)).toEqual(["ROOM_DOUBLE_BOOKING", "LONG_CONSECUTIVE_DAY"]);
    expect(groups[1].occurrence_count).toBe(3);
    expect(groups[1].affected_sessions.map((item) => item.module_code)).toEqual(["CVE2142", "CVE2151", "ICT1013"]);
    expect(groups[1].details).toHaveLength(2);
    expect(groups[1].details[0].occurrence_count).toBe(2);
    expect(groups[1].details[0].affected_sessions.map((item) => item.module_code)).toEqual(["CVE2142", "CVE2151"]);
  });
});

function conflict(
  id: number,
  severity: ReportConflict["severity"],
  constraintCode: string,
  message: string,
  affectedSessions: ReportConflict["affected_sessions"],
): ReportConflict {
  return {
    id,
    schedule_run_id: 1,
    severity,
    constraint_code: constraintCode,
    message,
    affected_session_ids: affectedSessions.map((item) => item.session_id),
    affected_sessions: affectedSessions,
  };
}

function session(sessionId: number, moduleCode: string): ReportConflict["affected_sessions"][number] {
  return {
    session_id: sessionId,
    requirement_id: null,
    module_code: moduleCode,
    student_group_code: null,
    placement: "Monday 09:00-10:00",
  };
}
