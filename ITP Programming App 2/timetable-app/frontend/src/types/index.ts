export type ValidationIssue = {
  row: number;
  field: string;
  message: string;
};

export type ValidationResult = {
  is_valid: boolean;
  error_count: number;
  warning_count: number;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  schedule_issues?: {
    schedule_run_id: number | null;
    hard_count: number;
    soft_count: number;
    total: number;
  };
};

export type UploadSummary = {
  rows_read: number;
  rows_imported: number;
  rows_failed: number;
  errors: ValidationIssue[];
};

export type ScheduleRun = {
  id: number;
  created_at: string;
  status: string;
  solver_status: string | null;
  hard_violation_count: number;
  soft_score: number;
  message: string | null;
};

export type ScheduleResponse = {
  schedule_run: ScheduleRun;
  scheduled_sessions: ScheduledRow[];
};

export type ScheduleGenerateResult = {
  schedule_run_id: number;
  solver_status: string;
  hard_violation_count: number;
  soft_score: number;
  message: string;
};

export type ScheduledRow = {
  requirement_id: string | null;
  programme: string | null;
  year: number | null;
  module_code: string | null;
  class_type: string | null;
  student_group_code: string | null;
  staff_name: string | null;
  staff_id: string | null;
  room: string;
  day: string;
  start_time: string;
  end_time: string;
  week_pattern: string;
  delivery_mode: string | null;
  campus_mode: string | null;
};

export type ConstraintViolation = {
  id: number;
  schedule_run_id: number;
  constraint_code: string;
  severity: "HARD" | "SOFT";
  message: string;
  affected_session_ids: number[];
};

export type SessionRow = {
  id: number;
  requirement_id: string | null;
  programme: string | null;
  module_code: string | null;
  student_group_code: string | null;
  staff_name: string | null;
  staff_id: string | null;
  class_type: string | null;
  delivery_mode: string | null;
  campus_mode: string | null;
  duration_minutes: number | null;
  exact_class_size: number | null;
  week_pattern: string | null;
};

export type Dashboard = {
  total_sessions: number;
  imported_rows: number;
  validation: {
    is_valid: boolean;
    error_count: number;
    warning_count: number;
  };
  latest_schedule: ScheduleRun | null;
};
