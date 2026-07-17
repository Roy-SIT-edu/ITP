import { describe, expect, it } from "vitest";
import { conflictSelectionFilters } from "./timetableReviewFilters";

describe("conflict-list timetable filters", () => {
  it("switches to the selected module's programme and clears stale filters", () => {
    expect(conflictSelectionFilters("MEC")).toEqual({
      source: "",
      query: "",
      issue: "",
      classType: "",
      programme: "MEC",
      group: "",
      staff: "",
      room: "",
      day: "",
    });
  });
});
