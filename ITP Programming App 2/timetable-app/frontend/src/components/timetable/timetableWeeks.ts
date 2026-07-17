import type { ScheduledRow } from "../../types";

type WeekScheduledRow = Pick<ScheduledRow, "start_week" | "end_week" | "week_pattern" | "custom_weeks">;

export function rowOccursInWeek(row: WeekScheduledRow, weekNumber: number) {
  if (row.start_week && weekNumber < row.start_week) return false;
  if (row.end_week && weekNumber > row.end_week) return false;

  const customWeeks = parseWeekList(row.custom_weeks);
  if (customWeeks.length > 0) return customWeeks.includes(weekNumber);

  const pattern = (row.week_pattern || "Weekly").trim().toLowerCase();
  if (pattern === "odd") return weekNumber % 2 === 1;
  if (pattern === "even") return weekNumber % 2 === 0;
  return true;
}

export function firstOccurrenceWeek(row: WeekScheduledRow) {
  const startWeek = Math.max(1, row.start_week ?? 1);
  const endWeek = Math.max(startWeek, row.end_week ?? 52);
  for (let week = startWeek; week <= endWeek; week += 1) {
    if (rowOccursInWeek(row, week)) return week;
  }
  return null;
}

function parseWeekList(value: string | null) {
  if (!value) return [];
  return value
    .split(/[,\s;]+/)
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isFinite(item) && item > 0);
}
