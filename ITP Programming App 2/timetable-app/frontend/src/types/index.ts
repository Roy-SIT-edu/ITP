/*
 * Shared frontend types for API responses and table rows.
 * Keeping the contracts here makes page/component props easier to read.
 */

export type ValidationIssue = {
  row: number;
  field: string;
  message: string;
  requirement_id?: string | null;
  conflict_session_ids?: number[];
  source_file?: string | null;
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
  preview_rows?: ImportPreviewRow[];
};

export type UploadFileSummary = {
  filename: string;
  rows_read: number;
  error_count?: number;
  columns?: string[];
};

export type ImportPreviewRow = {
  row_id: string;
  source_file: string | null;
  source_row_no: number;
  values: Record<string, string | number | boolean | null>;
};

export type DatabaseColumn = {
  key: string;
  label: string;
  kind: "text" | "number" | "boolean" | "time";
  required: boolean;
  read_only: boolean;
  options?: string[];
  min_value?: number;
  max_value?: number;
  max_length?: number;
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
  quality?: ScheduleQuality;
};

export type ScheduleComparison = ScheduleRun & {
  scheduled_count: number;
  stored_hard_issues: number;
  stored_soft_issues: number;
  quality_score: number;
  quality: ScheduleQuality;
};

export type ScheduleQuality = {
  score: number;
  label: string;
  tone: "neutral" | "good" | "warn" | "bad" | "info";
  summary: string;
  hard_issue_count: number;
  soft_warning_count: number;
  affected_session_count: number;
  affected_session_percent: number;
  soft_pressure_per_session: number;
  raw_soft_score: number;
  export_ready: boolean;
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
  soft_warning_count?: number;
  soft_score: number;
  quality?: ScheduleQuality;
  message: string;
};

export type ReportBreakdownItem = {
  label: string;
  count: number;
  percent: number;
};

export type ReportWorkloadItem = {
  label: string;
  session_count: number;
  hours: number;
};

export type ReportSession = {
  scheduled_session_id: number;
  session_id: number;
  requirement_id: string | null;
  programme: string | null;
  module_code: string | null;
  class_type: string | null;
  student_group_code: string | null;
  staff_names: string[];
  room: string | null;
  day: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  week_pattern: string | null;
  custom_weeks: string | null;
  start_week: number | null;
  end_week: number | null;
  delivery_mode: string | null;
  campus_mode: string | null;
  scheduling_type: string | null;
  exact_class_size: number | null;
  source_file: string | null;
  is_lab_requirement: boolean;
  lab_requirement_id: number | null;
  hard_issue_count: number;
  soft_issue_count: number;
  issue_count: number;
  issue_codes: string[];
};

export type ReportConflict = ConstraintViolation & {
  affected_sessions: Array<{
    session_id: number;
    requirement_id: string | null;
    module_code: string | null;
    student_group_code: string | null;
    placement: string;
  }>;
};

export type ScheduleReport = {
  report_generated_at: string;
  run: ScheduleRun;
  quality: ScheduleQuality;
  quality_breakdown: {
    starting_score: number;
    hard_conflict_deduction: number;
    soft_warning_deduction: number;
    affected_session_deduction: number;
    preference_pressure_deduction: number;
    hard_conflict_cap_applied: boolean;
  };
  summary: {
    scheduled_count: number;
    uploaded_session_count: number;
    lab_session_count: number;
    programme_count: number;
    module_count: number;
    student_group_count: number;
    staff_count: number;
    room_count: number;
    total_scheduled_hours: number;
    hard_conflict_count: number;
    soft_warning_count: number;
    affected_session_count: number;
  };
  breakdowns: {
    by_source: ReportBreakdownItem[];
    by_programme: ReportBreakdownItem[];
    by_class_type: ReportBreakdownItem[];
    by_day: ReportBreakdownItem[];
    by_delivery_mode: ReportBreakdownItem[];
    room_workload: ReportWorkloadItem[];
    staff_workload: ReportWorkloadItem[];
  };
  conflicts: {
    hard_count: number;
    soft_count: number;
    affected_session_count: number;
    by_constraint: Array<{ severity: "HARD" | "SOFT"; constraint_code: string; count: number }>;
    items: ReportConflict[];
  };
  sessions: ReportSession[];
};

export type SoftConstraintPriority = {
  constraint_code: string;
  label: string;
  description: string;
  default_rank: number;
  rank: number;
  weight: number;
  isActive: boolean;
};

export type TimeSlot = {
  id: number;
  day: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  week_pattern: string;
};

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
  co_teacher_names?: string | null;
  co_teacher_ids?: string | null;
  room: string;
  day: string;
  start_time: string;
  end_time: string;
  start_week: number | null;
  end_week: number | null;
  week_pattern: string;
  custom_weeks: string | null;
  delivery_mode: string | null;
  campus_mode: string | null;
  source_file?: string | null;
  is_lab_requirement?: boolean;
  lab_requirement_id?: number | null;
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

export type QuickFixSuggestion = {
  type: "VENUE_CHANGE" | "TIME_CHANGE" | "ALTERNATIVE_BEST";
  description: string;
  session_id: number;
  new_room: string;
  new_time: string;
  room_code: string;
  day: string;
  start_time: string;
  end_time: string;
};

export type QuickFixResponse = {
  conflict_id: number | null;
  severity: "HARD" | "SOFT";
  session_id: number;
  suggestions: QuickFixSuggestion[];
};

export type SessionRow = {
  id: number;
  requirement_id: string | null;
  programme: string | null;
  module_code: string | null;
  student_group_code: string | null;
  staff_name: string | null;
  staff_id: string | null;
  co_teachers?: { staff_id: string | null; staff_name: string | null; is_primary: boolean; staff_order: number }[];
  co_teacher_names?: string | null;
  co_teacher_ids?: string | null;
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
  is_lab_requirement?: boolean;
  lab_requirement_id?: number | null;
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
  latest_schedule: (ScheduleRun & { scheduled_count: number }) | null;
};
