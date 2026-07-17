import { describe, expect, it } from "vitest";
import {
  buildFilterIssueToneMap,
  buildSessionIssueToneMap,
  filterIssueToneClass,
} from "./timetableFilterTones";

describe("timetable filter issue tones", () => {
  it("uses the highest issue severity found for a dropdown value", () => {
    const rows = [
      { session_id: 1, programme: "MEC" },
      { session_id: 2, programme: "MEC" },
      { session_id: 3, programme: "ICT" },
    ];
    const issues = new Map([
      [1, { hard: false, soft: true }],
      [2, { hard: true, soft: false }],
    ]);

    const tones = buildFilterIssueToneMap(rows, issues, (row) => [row.programme]);

    expect(tones.get("MEC")).toBe("hard");
    expect(tones.get("ICT")).toBe("clean");
  });

  it("returns stable classes for dropdown styling", () => {
    expect(filterIssueToneClass("soft")).toBe("filter-issue-tone-soft");
    expect(filterIssueToneClass(undefined)).toBe("");
  });

  it("assigns every timetable session its issue colour before selection", () => {
    const rows = [{ session_id: 1 }, { session_id: 2 }, { session_id: 3 }];
    const issues = new Map([
      [1, { hard: true, soft: false }],
      [2, { hard: false, soft: true }],
    ]);

    expect(Array.from(buildSessionIssueToneMap(rows, issues))).toEqual([
      [1, "hard"],
      [2, "soft"],
      [3, "clean"],
    ]);
  });
});
