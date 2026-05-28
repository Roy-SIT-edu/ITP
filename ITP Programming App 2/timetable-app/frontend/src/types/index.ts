/*
 * Shared frontend types for API responses and table rows.
 * Keeping the contracts here makes page/component props easier to read.
 */

export type ValidationIssue = {
  row: number;
  field: string;
  message: string;
<<<<<<< Updated upstream
=======
  requirement_id?: string | null;
  conflict_session_ids?: number[];
  source_file?: string | null;
>>>>>>> Stashed changes
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
    breakdown?: { constraint_code: string; severity: string; count: number }[];
  };
};

export type UploadSummary = {
  rows_read: number;
  rows_imported: number;
  rows_failed: number;
  errors: ValidationIssue[];
  file_summaries?: UploadFileSummary[];
};

export type UploadFileSummary = {
  filename: string;
  rows_read: number;
  error_count?: number;
  columns?: string[];
};

export type UploadPreview = {
  rows_read: number;
  rows_importable: number;
  rows_failed: number;
  errors: ValidationIssue[];
  file_summaries: UploadFileSummary[];
};

export type DemoSample = {
  id: string;
  label: string;
  filename: string;
  description: string;
  available: boolean;
};

export type DatabaseColumn = {
  key: string;
  label: string;
  kind: "text" | "number" | "boolean" | "time";
  required: boolean;
  read_only: boolean;
};

export type DatabaseTypeInfo = {
  id: string;
  label: string;
  columns: DatabaseColumn[];
};

export type DatabaseRow = {
  id: number;
  [key: string]: string | number | boolean | null;
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

export type ScheduleComparison = ScheduleRun & {
  scheduled_count: number;
  stored_hard_issues: number;
  stored_soft_issues: number;
  quality_score: number;
};

export type ScheduleExplanation = {
  session_id: number;
  requirement_id: string | null;
  module_code: string | null;
  placement: string;
  reasons: string[];
  issues: ConstraintViolation[];
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

<<<<<<< Updated upstream
=======
export type TimeSlot = {
  id: number;
  day: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  week_pattern: string;
};

>>>>>>> Stashed changes
export type ScheduledRow = {
  scheduled_session_id: number;
  session_id: number;
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

export type Room = {
  id: number;
  room_code: string;
  room_name: string | null;
  room_type: string | null;
  capacity: number | null;
  is_virtual: boolean;
  campus_mode: string | null;
  recording_available: boolean;
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
  venue_type_required: string | null;
  duration_minutes: number | null;
  sessions_per_week: number | null;
  exact_class_size: number | null;
  start_week: number | null;
  end_week: number | null;
  week_pattern: string | null;
  custom_weeks: string | null;
  scheduling_type: string | null;
  fixed_day: string | null;
  fixed_start_time: string | null;
  fixed_end_time: string | null;
  preferred_days: string | null;
  avoid_days: string | null;
  priority: string | null;
  remarks: string | null;
  source_file: string | null;
  source_row_no: number | null;
};

export type AvailabilityEntry = {
  session_id: number;
  requirement_id: string | null;
  module_code: string | null;
  day: string;
  start_time: string;
  end_time: string;
};

export type Availability = {
  schedule_run_id: number | null;
  slots: TimeSlot[];
  staff: { name: string; busy: AvailabilityEntry[] }[];
  rooms: { room_code: string; busy: AvailabilityEntry[] }[];
};

export type ConstraintInsights = {
  validation_error_count: number;
  validation_warning_count: number;
  latest_schedule_id: number | null;
  top_issues: { code: string; severity: string; count: number }[];
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
