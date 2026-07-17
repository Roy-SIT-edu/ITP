import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ScheduleGenerateResult } from "../types";
import AutoDeconflictStatus from "./AutoDeconflictStatus";

function result(overrides: Partial<ScheduleGenerateResult> = {}): ScheduleGenerateResult {
  return {
    schedule_run_id: 12,
    source_schedule_run_id: 7,
    solver_status: "FEASIBLE",
    hard_violation_count: 0,
    remaining_hard_violation_count: 0,
    moved_session_count: 2,
    timed_out: false,
    unresolved_fixed_session_ids: [],
    unresolved_lab_session_ids: [],
    soft_score: 5,
    message: "Auto-deconflict completed.",
    ...overrides,
  };
}

describe("AutoDeconflictStatus", () => {
  it("uses the same estimated solver progress display as timetable generation", () => {
    render(<AutoDeconflictStatus running elapsedSeconds={4.2} estimatedSeconds={10} result={null} />);

    expect(screen.getByText("4s")).toBeInTheDocument();
    expect(screen.getByText(/About 6s remaining/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Estimated auto deconflict progress" })).toHaveAttribute(
      "aria-valuenow",
      "38",
    );
    expect(screen.getByText("Estimated progress 38%")).toBeInTheDocument();
  });

  it("reports successful moves and zero remaining hard conflicts", () => {
    render(<AutoDeconflictStatus running={false} elapsedSeconds={0} estimatedSeconds={10} result={result()} />);

    expect(screen.getByRole("status")).toHaveClass("good");
    expect(screen.getByText(/Moved sessions: 2/)).toBeInTheDocument();
    expect(screen.getByText(/Remaining hard conflicts: 0/)).toBeInTheDocument();
  });

  it("reports unresolved built-in lab sessions as a blocking result", () => {
    render(
      <AutoDeconflictStatus
        running={false}
        elapsedSeconds={0}
        estimatedSeconds={10}
        result={result({
          hard_violation_count: 1,
          remaining_hard_violation_count: 1,
          moved_session_count: 0,
          unresolved_lab_session_ids: [41, 52],
        })}
      />,
    );

    expect(screen.getByRole("status")).toHaveClass("bad");
    expect(screen.getByText(/Built-in lab session IDs/)).toBeInTheDocument();
    expect(screen.getByText(/41, 52/)).toBeInTheDocument();
  });
});
