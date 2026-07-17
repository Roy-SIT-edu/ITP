import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledRow, TimeSlot } from "../../types";
import TimetableGrid from "./TimetableGrid";

const apiMocks = vi.hoisted(() => ({
  getAcademicCalendarContext: vi.fn(),
  getCalendarWeeks: vi.fn(),
  getSession: vi.fn(),
  updateSession: vi.fn(),
  recheckSchedule: vi.fn(),
}));

vi.mock("../../api/client", () => apiMocks);

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

const placementSlots: TimeSlot[] = [
  {
    id: 1,
    day: "Monday",
    start_time: "09:00",
    end_time: "10:00",
    duration_minutes: 60,
    week_pattern: "Weekly",
  },
  {
    id: 2,
    day: "Tuesday",
    start_time: "10:00",
    end_time: "11:00",
    duration_minutes: 60,
    week_pattern: "Weekly",
  },
];

function calendarContext(date: string, overrides: Record<string, unknown> = {}) {
  return {
    selected_date: date,
    week: {
      id: 1,
      academic_year: "2026/27",
      trimester: 1,
      week_number: 1,
      start_date: date,
      end_date: date,
      phase: "STUDY",
      phase_label: "Study Week",
      is_provisional: false,
      notes: null,
      holiday_marker: "",
    },
    holidays: [],
    occurrences: [],
    makeup_required_count: 0,
    lessons_blocked: false,
    ...overrides,
  };
}

describe("TimetableGrid session selection", () => {
  beforeEach(() => {
    apiMocks.getAcademicCalendarContext.mockImplementation((date: string) => Promise.resolve(calendarContext(date)));
    apiMocks.getCalendarWeeks.mockResolvedValue([]);
    apiMocks.getSession.mockResolvedValue({ id: row.session_id });
  });

  it("shows 6:00 PM as the timetable endpoint without adding a later slot", () => {
    render(<TimetableGrid rows={[row]} />);

    expect(screen.getByTestId("calendar-terminal-time")).toHaveTextContent("6:00PM");
    expect(screen.queryByLabelText("Monday 6:00PM slot")).not.toBeInTheDocument();
  });

  it("focuses the requested teaching week", async () => {
    apiMocks.getCalendarWeeks.mockResolvedValue([
      { ...calendarContext("2026-08-31").week, week_number: 1, start_date: "2026-08-31" },
      { ...calendarContext("2026-09-28").week, week_number: 5, start_date: "2026-09-28" },
    ]);

    render(
      <TimetableGrid
        academicYear="2026/27"
        focusWeekNumber={5}
        focusWeekRequestKey={1}
        rows={[row]}
        trimester={1}
      />,
    );

    await waitFor(() => expect(screen.getByLabelText("Show Week Of")).toHaveValue("2026-09-28"));
  });

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

  it("clears the selected session and placement state when reset externally", async () => {
    const user = userEvent.setup();
    const onSelectSession = vi.fn();
    const { container, rerender } = render(
      <TimetableGrid editable onSelectSession={onSelectSession} rows={[row]} selectionResetKey={0} />,
    );

    await user.click(container.querySelector<HTMLButtonElement>(".calendar-event")!);
    expect(container.querySelector(".calendar-event")).toHaveAttribute("aria-pressed", "true");

    rerender(<TimetableGrid editable onSelectSession={onSelectSession} rows={[row]} selectionResetKey={1} />);

    await waitFor(() => expect(container.querySelector(".calendar-event")).toHaveAttribute("aria-pressed", "false"));
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

  it("keeps the module selected when a different available timetable slot is clicked", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();

    function PlacementHarness() {
      const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
      return (
        <TimetableGrid
          editable
          rows={[row]}
          timeSlots={placementSlots}
          availableSlotKeys={activeSessionId ? new Set(["Tuesday|10:00|11:00"]) : new Set()}
          onClickAvailableSlot={onMove}
          onSelectSession={setActiveSessionId}
        />
      );
    }

    const { container } = render(<PlacementHarness />);
    await user.click(container.querySelector<HTMLButtonElement>(".calendar-event")!);
    const availableSlot = screen.getByLabelText("Tuesday 10:00AM slot");
    expect(availableSlot).toHaveClass("conflict-available");
    expect(availableSlot).not.toHaveClass("conflict-soft-available", "conflict-blocked");
    await user.click(availableSlot);

    expect(onMove).toHaveBeenCalledWith("Tuesday", "10:00", "11:00");
  });

  it("keeps a soft-constraint slot yellow and movable", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(
      <TimetableGrid
        editable
        rows={[row]}
        timeSlots={placementSlots}
        availableSlotKeys={new Set(["Tuesday|10:00|11:00"])}
        softAvailableSlotKeys={new Set(["Tuesday|10:00|11:00"])}
        onClickAvailableSlot={onMove}
      />,
    );

    const softSlot = screen.getByLabelText("Tuesday 10:00AM slot");
    expect(softSlot).toHaveClass("conflict-soft-available");
    expect(softSlot).not.toHaveClass("conflict-available", "conflict-blocked");
    await user.click(softSlot);

    expect(onMove).toHaveBeenCalledWith("Tuesday", "10:00", "11:00");
  });

  it("keeps a hard-conflict slot red and prevents the move", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const onBlocked = vi.fn();
    render(
      <TimetableGrid
        editable
        rows={[row]}
        timeSlots={placementSlots}
        blockedSlotKeys={new Set(["Tuesday|10:00|11:00"])}
        onBlockedSlot={onBlocked}
        onClickAvailableSlot={onMove}
      />,
    );

    const blockedSlot = screen.getByLabelText("Tuesday 10:00AM slot");
    expect(blockedSlot).toHaveClass("conflict-blocked");
    expect(blockedSlot).not.toHaveClass("conflict-available", "conflict-soft-available");
    await user.click(blockedSlot);

    expect(onMove).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledWith("Cannot move here: this slot creates a hard conflict.");
  });

  it("shows module issue colours before the module is selected", () => {
    const softRow: ScheduledRow = {
      ...row,
      scheduled_session_id: 2,
      session_id: 12,
      module_code: "SOFT202",
      day: "Tuesday",
      start_time: "10:00",
      end_time: "11:00",
    };
    const { container } = render(
      <TimetableGrid
        issueToneBySessionId={new Map([[row.session_id, "hard"], [softRow.session_id, "soft"]])}
        rows={[row, softRow]}
        timeSlots={placementSlots}
      />,
    );

    const events = Array.from(container.querySelectorAll<HTMLButtonElement>(".calendar-event"));
    expect(events.find((event) => event.textContent?.includes("TEST101"))).toHaveClass("issue-tone-hard");
    expect(events.find((event) => event.textContent?.includes("SOFT202"))).toHaveClass("issue-tone-soft");
  });

  it("flags a holiday occurrence for make-up and removes it from the dated view", async () => {
    apiMocks.getAcademicCalendarContext.mockImplementation((date: string) =>
      Promise.resolve(
        calendarContext(date, {
          week: {
            ...calendarContext(date).week,
            holiday_marker: "^",
          },
          holidays: [
            {
              id: 1,
              date,
              name: "National Day (Observed)",
              day: "Monday",
              is_observed: true,
              source: "MOM/data.gov.sg",
              is_manual_override: false,
            },
          ],
          occurrences: [
            {
              id: 1,
              schedule_run_id: 77,
              scheduled_session_id: row.scheduled_session_id,
              session_id: row.session_id,
              date,
              academic_year: "2026/27",
              trimester: 1,
              week_number: 1,
              status: "MAKEUP_REQUIRED",
              reason: "Public holiday; make-up session required.",
              holiday_name: "National Day (Observed)",
            },
          ],
          makeup_required_count: 1,
        }),
      ),
    );

    const { container } = render(<TimetableGrid rows={[row]} scheduleRunId={77} />);

    await waitFor(() => expect(screen.getByText(/1 class need make-up sessions/)).toBeInTheDocument());
    expect(screen.getByText("National Day (Observed)")).toBeInTheDocument();
    expect(container.querySelector(".calendar-event")).toBeNull();
    const holidaySlot = screen.getByLabelText("Monday 9:00AM slot");
    expect(holidaySlot).toHaveClass("conflict-blocked");
    expect(holidaySlot).not.toHaveClass("conflict-available", "conflict-soft-available");
    expect(holidaySlot).toBeDisabled();
  });

  it("blocks every lesson during recess, assessment, and break phases", async () => {
    apiMocks.getAcademicCalendarContext.mockImplementation((date: string) =>
      Promise.resolve(
        calendarContext(date, {
          week: {
            ...calendarContext(date).week,
            phase: "RECESS",
            phase_label: "Recess Week",
          },
          lessons_blocked: true,
        }),
      ),
    );

    const { container } = render(<TimetableGrid rows={[row]} />);

    await waitFor(() =>
      expect(screen.getByText("No lessons are scheduled during this academic-calendar week.")).toBeInTheDocument(),
    );
    expect(container.querySelector(".calendar-event")).toBeNull();
  });
});
