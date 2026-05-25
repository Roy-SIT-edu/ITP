import type {
  ConstraintViolation,
  Dashboard,
  DatabaseRow,
  DatabaseTypeInfo,
  ScheduleGenerateResult,
  ScheduleResponse,
  SessionRow,
  UploadSummary,
  ValidationResult,
} from "../types";

export const API_BASE = import.meta.env.VITE_API_URL ?? "";

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
    const detail = typeof payload === "object" && payload && "detail" in payload ? payload.detail : payload;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail) && detail.length > 0 && typeof detail[0] === "object" && detail[0] && "msg" in detail[0]
          ? String(detail[0].msg)
          : Array.isArray(detail) && detail.length > 0 && typeof detail[0] === "object" && detail[0] && "message" in detail[0]
            ? String(detail[0].message)
          : typeof detail === "object" && detail && "message" in detail
            ? String(detail.message)
            : `Request failed with status ${response.status}`;
    throw new ApiError(response.status, message, detail);
  }
  return payload as T;
}

export function getDashboard() {
  return request<Dashboard>("/api/dashboard");
}

export function getSessions() {
  return request<SessionRow[]>("/api/sessions");
}

export function uploadTemplate(files: File[]) {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  return request<UploadSummary>("/api/upload/input-template", {
    method: "POST",
    body: formData,
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

export function getValidation() {
  return request<ValidationResult>("/api/validation/latest");
}

export function generateSchedule() {
  return request<ScheduleGenerateResult>("/api/schedules/generate", {
    method: "POST",
  });
}

export function getLatestSchedule() {
  return request<ScheduleResponse>("/api/schedules/latest");
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
