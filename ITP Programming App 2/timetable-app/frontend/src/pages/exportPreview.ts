import type { ExportPreviewCell } from "../types";

export type ExportPreviewRow = Record<string, ExportPreviewCell>;

export function filterExportPreviewRows(rows: ExportPreviewRow[], columns: string[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return rows;
  return rows.filter((row) =>
    columns.some((column) =>
      String(row[column] ?? "")
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    ),
  );
}

export function paginateExportPreviewRows(rows: ExportPreviewRow[], requestedPage: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const startIndex = rows.length === 0 ? 0 : (page - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, rows.length);
  return {
    page,
    pageCount,
    startIndex,
    endIndex,
    rows: rows.slice(startIndex, endIndex),
  };
}

export function exportPreviewCellLabel(value: ExportPreviewCell) {
  if (value === null || value === "") return "—";
  return String(value);
}
