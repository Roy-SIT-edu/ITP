import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import GenerationPeriodSelector from "./GenerationPeriodSelector";

const academicYears = [
  {
    academic_year: "2025/26",
    start_date: "2025-09-01",
    end_date: "2026-08-30",
    is_provisional: false,
    trimesters: [1, 2, 3],
  },
  {
    academic_year: "2026/27",
    start_date: "2026-08-31",
    end_date: "2027-08-29",
    is_provisional: false,
    trimesters: [1, 2, 3],
  },
];

describe("GenerationPeriodSelector", () => {
  it("shows the selected default planning period", () => {
    render(
      <GenerationPeriodSelector
        academicYear="2026/27"
        academicYears={academicYears}
        trimester={1}
        onAcademicYearChange={vi.fn()}
        onTrimesterChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Academic Year")).toHaveValue("2026/27");
    expect(screen.getByLabelText("Trimester")).toHaveValue("1");
    expect(screen.getByText(/Timetable will be generated for/)).toHaveTextContent("AY 2026/27, Trimester 1");
  });

  it("reports administrator changes", async () => {
    const user = userEvent.setup();
    const onAcademicYearChange = vi.fn();
    const onTrimesterChange = vi.fn();
    render(
      <GenerationPeriodSelector
        academicYear="2026/27"
        academicYears={academicYears}
        trimester={1}
        onAcademicYearChange={onAcademicYearChange}
        onTrimesterChange={onTrimesterChange}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Academic Year"), "2025/26");
    await user.selectOptions(screen.getByLabelText("Trimester"), "2");

    expect(onAcademicYearChange).toHaveBeenCalledWith("2025/26");
    expect(onTrimesterChange).toHaveBeenCalledWith(2);
  });
});
