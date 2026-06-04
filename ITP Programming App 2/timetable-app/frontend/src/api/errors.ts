import { ApiError } from "./client";

export function formatApiError(err: unknown, fallback: string) {
  if (err instanceof ApiError && Array.isArray(err.details)) {
    const messages = err.details
      .map((item) => {
        if (typeof item === "object" && item && "message" in item) {
          const issue = item as { field?: string; message?: string; row?: number };
          const field = issue.field ? `${issue.field}: ` : "";
          const row = issue.row ? `Row ${issue.row} - ` : "";
          return `${row}${field}${issue.message}`;
        }
        return String(item);
      })
      .filter(Boolean);

    if (messages.length > 0) return messages.slice(0, 6).join("\n");
  }

  return err instanceof Error ? err.message : fallback;
}
