import { describe, expect, it } from "vitest";

import type { ScheduleGenerateResult } from "./types";
import { solverMethodLabel, solverMethodNotice, solverMethodUsed } from "./solverMethod";

function result(overrides: Partial<ScheduleGenerateResult> = {}): ScheduleGenerateResult {
  return {
    schedule_run_id: 4,
    academic_year: "2026/27",
    trimester: 1,
    solver_status: "FEASIBLE",
    hard_violation_count: 0,
    soft_score: 0,
    message: "Schedule generated successfully",
    ...overrides,
  };
}

describe("solver method presentation", () => {
  it.each(["strict", "relaxed", "greedy"] as const)("presents the explicit %s method", (solverMethod) => {
    const generation = result({ solver_method: solverMethod });

    expect(solverMethodUsed(generation)).toBe(solverMethod);
    expect(solverMethodLabel(generation)).toBe(solverMethod[0].toUpperCase() + solverMethod.slice(1));
  });

  it("uses a concise solver-method notice", () => {
    expect(solverMethodNotice(result({ solver_method: "greedy" }))).toBe("Solver method used: Greedy.");
  });

  it("recognises a legacy greedy fallback result", () => {
    expect(
      solverMethodUsed(
        result({
          message: "Fixed hard clashes are present; generated a reviewable timetable with conflict checks.",
        }),
      ),
    ).toBe("greedy");
  });
});
