import type { ScheduleGenerateResult } from "./types";

export type SolverMethod = NonNullable<ScheduleGenerateResult["solver_method"]>;

export function solverMethodUsed(result: ScheduleGenerateResult): SolverMethod {
  if (result.solver_method) return result.solver_method;

  // Compatibility for an in-memory result created before solver_method was
  // added to the API response.
  if (/reviewable timetable|solver timed out|budget was exhausted/i.test(result.message)) {
    return "greedy";
  }
  if (result.hard_violation_count > 0) return "relaxed";
  return "strict";
}

export function solverMethodLabel(result: ScheduleGenerateResult) {
  const method = solverMethodUsed(result);
  return method[0].toUpperCase() + method.slice(1);
}

export function solverMethodNotice(result: ScheduleGenerateResult) {
  return `Solver method used: ${solverMethodLabel(result)}.`;
}
