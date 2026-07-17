import { describe, expect, it } from "vitest";
import { firstOccurrenceWeek, rowOccursInWeek } from "./timetableWeeks";

describe("timetable teaching weeks", () => {
  it("uses the first valid custom week", () => {
    const row = { start_week: 5, end_week: 12, week_pattern: "Odd", custom_weeks: "9, 5, 12" };
    expect(firstOccurrenceWeek(row)).toBe(5);
    expect(rowOccursInWeek(row, 6)).toBe(false);
  });

  it("respects odd and even patterns within their bounds", () => {
    expect(firstOccurrenceWeek({ start_week: 2, end_week: 9, week_pattern: "Odd", custom_weeks: null })).toBe(3);
    expect(firstOccurrenceWeek({ start_week: 1, end_week: 8, week_pattern: "Even", custom_weeks: null })).toBe(2);
  });

  it("uses the start week for a weekly session", () => {
    expect(firstOccurrenceWeek({ start_week: 4, end_week: 10, week_pattern: "Weekly", custom_weeks: null })).toBe(4);
  });
});
