import type { TimetableIssueTone } from "../components/timetable/types";

export type FilterIssueTone = TimetableIssueTone;

type IssueState = { hard: boolean; soft: boolean };

export function buildFilterIssueToneMap<T extends { session_id: number }>(
  rows: T[],
  issueBySessionId: Map<number, IssueState>,
  valuesForRow: (row: T) => Array<string | null | undefined>,
) {
  const tones = new Map<string, FilterIssueTone>();

  for (const row of rows) {
    const issue = issueBySessionId.get(row.session_id);
    const rowTone: FilterIssueTone = issue?.hard ? "hard" : issue?.soft ? "soft" : "clean";
    for (const value of valuesForRow(row)) {
      if (!value) continue;
      tones.set(value, higherPriorityTone(tones.get(value), rowTone));
    }
  }

  return tones;
}

export function filterIssueToneClass(tone: FilterIssueTone | undefined) {
  return tone ? `filter-issue-tone-${tone}` : "";
}

export function buildSessionIssueToneMap<T extends { session_id: number }>(
  rows: T[],
  issueBySessionId: Map<number, IssueState>,
) {
  return new Map<number, TimetableIssueTone>(
    rows.map((row) => {
      const issue = issueBySessionId.get(row.session_id);
      return [row.session_id, issue?.hard ? "hard" : issue?.soft ? "soft" : "clean"];
    }),
  );
}

function higherPriorityTone(current: FilterIssueTone | undefined, next: FilterIssueTone) {
  if (current === "hard" || next === "hard") return "hard";
  if (current === "soft" || next === "soft") return "soft";
  return "clean";
}
