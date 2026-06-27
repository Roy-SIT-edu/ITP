import type { SessionRow, ValidationIssue } from "../../types";

export type ValidationIssueRow = ValidationIssue & {
  level: "Error";
};

export type ConflictSessions = {
  anchor?: SessionRow;
  target?: SessionRow;
} | null;

export type QuickEditValues = {
  fixed_day: string;
  fixed_start_time: string;
  fixed_end_time: string;
  scheduling_type: string;
  student_group_code: string;
};

export type QuickSuggestion = {
  label: string;
  detail: string;
  apply: () => void;
};
