/*
 * Frontend API client.
 * Centralizes fetch calls, error parsing, upload form-data, and export URLs.
 */

import type {
  ConstraintViolation,
  Availability,
  ConstraintInsights,
  Dashboard,
  DatabaseRow,
  DatabaseTypeInfo,
  ImportPreviewRow,
  QuickFixResponse,
  Room,
  ScheduleComparison,
  ScheduleExplanation,
  ScheduleGenerateResult,
  ScheduleRun,
  ScheduleResponse,
  SessionRow,
  SoftConstraintPriority,
  TimeSlot,
  UploadSummary,
  ValidationResult,
} from "../types";

export const API_BASE = import.meta.env.VITE_API_URL ?? "";

type SoftConstraintPriorityResponse = Omit<SoftConstraintPriority, "isActive"> & {
  is_active?: boolean;
  isActive?: boolean;
};

type SoftConstraintPriorityUpdate = Pick<SoftConstraintPriority, "constraint_code"> & {
  isActive?: boolean;
};

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(status: number, message: string, details: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, options);
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    // FastAPI may return strings, Pydantic errors, or row-level validation arrays.
    const detail = typeof payload === "object" && payload && "detail" in payload ? payload.detail : payload;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail) && detail.length > 0 && typeof detail[0] === "object" && detail[0] && "msg" in detail[0]
          ? String(detail[0].msg)
          : Array.isArray(detail) &&
              detail.length > 0 &&
              typeof detail[0] === "object" &&
              detail[0] &&
              "message" in detail[0]
            ? String(detail[0].message)
            : typeof detail === "object" && detail && "message" in detail
              ? String(detail.message)
              : `Request failed with status ${response.status}`;
    throw new ApiError(response.status, message, detail);
  }
  return payload as T;
}

function normalizeSoftConstraintPriority(item: SoftConstraintPriorityResponse): SoftConstraintPriority {
  return {
    ...item,
    isActive: item.isActive ?? item.is_active ?? true,
  };
}

export function getDashboard() {
  return request<Dashboard>("/api/dashboard");
}

export function getSessions() {
  return request<SessionRow[]>("/api/sessions");
}

export function getSession(id: number) {
  return request<SessionRow>(`/api/sessions/${id}`);
}

export function getTimeSlots() {
  return request<TimeSlot[]>("/api/timeslots");
}

export function getRooms() {
  return request<Room[]>("/api/rooms");
}

export function uploadTemplate(files: File[]) {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  return request<UploadSummary>("/api/upload/input-template", {
    method: "POST",
    body: formData,
  });
}

export function importEditedTemplateRows(rows: ImportPreviewRow[]) {
  return request<UploadSummary>("/api/upload/input-template/edited", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
}

export function getDatabaseTypes() {
  return request<DatabaseTypeInfo[]>("/api/database/types");
}

export function getDatabaseRows(dataType: string) {
  return request<DatabaseRow[]>(`/api/database/${dataType}`);
}

export function createDatabaseRow(dataType: string, data: Record<string, unknown>) {
  return request<DatabaseRow>(`/api/database/${dataType}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function updateDatabaseRow(dataType: string, id: number, data: Record<string, unknown>) {
  return request<DatabaseRow>(`/api/database/${dataType}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function deleteDatabaseRow(dataType: string, id: number) {
  return request<{ message: string }>(`/api/database/${dataType}/${id}`, {
    method: "DELETE",
  });
}

export function uploadDatabaseFile(dataType: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return request<UploadSummary>(`/api/database/${dataType}/upload`, {
    method: "POST",
    body: formData,
  });
}

export function databaseExampleUrl(dataType: string) {
  return `${API_BASE}/api/database/${dataType}/example.xlsx`;
}

export function databaseCurrentInputUrl(dataType: string) {
  return `${API_BASE}/api/database/${dataType}/current.xlsx`;
}

export function getValidation() {
  return request<ValidationResult>("/api/validation/latest");
}

export function generateSchedule() {
  return request<ScheduleGenerateResult>("/api/schedules/generate", {
    method: "POST",
  });
}

export function getSoftConstraintPriorities() {
  return request<SoftConstraintPriorityResponse[]>("/api/soft-constraints").then((items) =>
    items.map(normalizeSoftConstraintPriority),
  );
}

export function updateSoftConstraintPriorities(priorities: SoftConstraintPriorityUpdate[] | string[]) {
  const normalized = priorities.map((item) =>
    typeof item === "string"
      ? { constraint_code: item, isActive: true }
      : { constraint_code: item.constraint_code, isActive: item.isActive !== false },
  );
  const activeItems = normalized.filter((item) => item.isActive);
  const inactiveItems = normalized.filter((item) => !item.isActive);
  const displayList = [...activeItems, ...inactiveItems];

  return request<SoftConstraintPriorityResponse[]>("/api/soft-constraints", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ordered_codes: displayList.map((item) => item.constraint_code),
      active_codes: activeItems.map((item) => item.constraint_code),
    }),
  }).then((items) => items.map(normalizeSoftConstraintPriority));
}

export function getScheduleRuns() {
  return request<ScheduleRun[]>("/api/schedules");
}

export function compareSchedules(ids?: number[]) {
  const query = ids?.length ? `?${ids.map((id) => `ids=${id}`).join("&")}` : "";
  return request<ScheduleComparison[]>(`/api/schedules/compare${query}`);
}

export function getLatestSchedule() {
  return request<ScheduleResponse>("/api/schedules/latest");
}

export function getSchedule(id: number) {
  return request<ScheduleResponse>(`/api/schedules/${id}`);
}

export function getScheduleExplanations(scheduleRunId: number) {
  return request<ScheduleExplanation[]>(`/api/schedules/${scheduleRunId}/explanations`);
}

export function moveScheduledSession(
  scheduleRunId: number,
  sessionId: number,
  data: { day: string; start_time: string; end_time: string; room_code: string },
) {
  return request<{ message: string; schedule_run: ScheduleRun | null; violations: ConstraintViolation[] }>(
    `/api/schedules/${scheduleRunId}/sessions/${sessionId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );
}

export function suggestScheduleFixes(
  scheduleRunId: number,
  data: { conflict_id?: number | null; session_id?: number | null },
) {
  return request<QuickFixResponse>(`/api/schedules/${scheduleRunId}/suggest-fixes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function recheckSchedule(scheduleRunId: number) {
  return request<{ message: string; schedule_run: ScheduleRun | null; violations: ConstraintViolation[] }>(
    `/api/schedules/${scheduleRunId}/recheck`,
    {
      method: "POST",
    },
  );
}

export function getViolations(scheduleRunId: number) {
  return request<ConstraintViolation[]>(`/api/schedules/${scheduleRunId}/violations`);
}

export function exportUrl(scheduleRunId: number, format: "csv" | "xlsx") {
  return `${API_BASE}/api/export/${scheduleRunId}/${format}`;
}

export function createSession(data: Omit<SessionRow, "id">) {
  return request<SessionRow>("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function updateSession(id: number, data: Partial<SessionRow>) {
  return request<SessionRow>(`/api/sessions/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function deleteSession(id: number) {
  return request<{ message: string }>(`/api/sessions/${id}`, {
    method: "DELETE",
  });
}

export function resetRequirementInputs() {
  return request<{ message: string; rows_deleted: number }>("/api/sessions", {
    method: "DELETE",
  });
}

export function getAvailability() {
  return request<Availability>("/api/availability");
}

export function getConstraintInsights() {
  return request<ConstraintInsights>("/api/constraint-insights");
}
