import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConstraintViolation } from "../types";
import ConflictTable from "./ConflictTable";

const violations: ConstraintViolation[] = [
  {
    id: 1,
    schedule_run_id: 2,
    constraint_code: "ROOM_DOUBLE_BOOKING",
    severity: "HARD",
    message: "Room overlap",
    affected_session_ids: [11, 12],
  },
  {
    id: 2,
    schedule_run_id: 2,
    constraint_code: "SHORT_CAMPUS_DAY",
    severity: "SOFT",
    message: "Short day",
    affected_session_ids: [13],
  },
];

describe("ConflictTable", () => {
  it("greys out quick fixes that have no available suggestion", () => {
    const { container } = render(
      <ConflictTable
        violations={violations}
        onToggleQuickFix={vi.fn()}
        renderQuickFixTray={() => null}
        quickFixState={(violation) => (violation.id === 2 ? "unavailable" : "available")}
      />,
    );

    expect(screen.getByRole("button", { name: "Quick Fix" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "No Fix" })).toBeDisabled();
    expect(screen.getByText("Blocking")).toBeInTheDocument();
    expect(container.querySelector(".conflict-group-indicator.soft")).toHaveTextContent("Optional");
  });
});
