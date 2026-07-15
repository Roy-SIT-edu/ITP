import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ScheduledRow } from "../../types";
import TimetableGrid from "./TimetableGrid";

const row: ScheduledRow = {
  scheduled_session_id: 1,
  session_id: 11,
  requirement_id: "REQ-11",
  programme: "TEST",
  year: 1,
  module_code: "TEST101",
  class_type: "Lecture",
  student_group_code: "TEST Y1 P1",
  staff_name: "Test Lecturer",
  staff_id: "STAFF-1",
  room: "ROOM-1",
  day: "Monday",
  start_time: "09:00",
  end_time: "10:00",
  start_week: 1,
  end_week: 52,
  week_pattern: "Weekly",
  custom_weeks: null,
  delivery_mode: "Face-to-face",
  campus_mode: "Campus",
};

describe("TimetableGrid session selection", () => {
  it("clears a selected session when the user clicks elsewhere", async () => {
    const user = userEvent.setup();
    const onSelectSession = vi.fn();
    const { container } = render(<TimetableGrid editable onSelectSession={onSelectSession} rows={[row]} />);
    const event = container.querySelector<HTMLButtonElement>(".calendar-event");

    expect(event).not.toBeNull();
    expect(event).toHaveAttribute("aria-pressed", "false");

    await user.click(event!);
    expect(event).toHaveAttribute("aria-pressed", "true");
    expect(onSelectSession).toHaveBeenLastCalledWith(row.session_id);

    await user.click(screen.getByText("Display Options"));
    expect(event).toHaveAttribute("aria-pressed", "false");
    expect(onSelectSession).toHaveBeenLastCalledWith(null);
    expect(screen.getByText("Select a session from the timetable to view or edit it.")).toBeInTheDocument();
  });

  it("keeps the session selected while using its details panel", async () => {
    const user = userEvent.setup();
    const onSelectSession = vi.fn();
    const { container } = render(<TimetableGrid editable onSelectSession={onSelectSession} rows={[row]} />);
    const event = container.querySelector<HTMLButtonElement>(".calendar-event");

    await user.click(event!);
    await user.click(screen.getByText("Selected Session"));

    expect(event).toHaveAttribute("aria-pressed", "true");
    expect(onSelectSession).not.toHaveBeenCalledWith(null);
  });
});
