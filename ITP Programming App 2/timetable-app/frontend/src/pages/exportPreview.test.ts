import { describe, expect, it } from "vitest";
import {
  exportPreviewCellLabel,
  filterExportPreviewRows,
  paginateExportPreviewRows,
  type ExportPreviewRow,
} from "./exportPreview";

const columns = ["Module", "Day", "Room1"];
const rows: ExportPreviewRow[] = [
  { Module: "DSC2204", Day: "Mon", Room1: "E2-01-01" },
  { Module: "INF1003", Day: "Tue", Room1: "E6-07-09" },
  { Module: "UCS1001", Day: "Fri", Room1: null },
];

describe("export dataframe preview helpers", () => {
  it("filters across every exported column without changing the source rows", () => {
    expect(filterExportPreviewRows(rows, columns, "e6-07")).toEqual([rows[1]]);
    expect(filterExportPreviewRows(rows, columns, "fri")).toEqual([rows[2]]);
    expect(filterExportPreviewRows(rows, columns, "")).toBe(rows);
  });

  it("paginates and clamps pages after filtering", () => {
    expect(paginateExportPreviewRows(rows, 1, 2)).toMatchObject({
      page: 1,
      pageCount: 2,
      startIndex: 0,
      endIndex: 2,
      rows: [rows[0], rows[1]],
    });
    expect(paginateExportPreviewRows(rows, 9, 2)).toMatchObject({
      page: 2,
      pageCount: 2,
      rows: [rows[2]],
    });
  });

  it("renders empty dataframe cells consistently", () => {
    expect(exportPreviewCellLabel(null)).toBe("—");
    expect(exportPreviewCellLabel("")).toBe("—");
    expect(exportPreviewCellLabel(0)).toBe("0");
  });
});
