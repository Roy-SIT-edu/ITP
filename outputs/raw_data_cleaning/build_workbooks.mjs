import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "C:/Users/Admin/Desktop/Code/Codes/INF1009/ITP/outputs/raw_data_cleaning";
const payload = JSON.parse(await fs.readFile(path.join(outputDir, "cleaned_raw_data.json"), "utf8"));

const uploadConfigs = {
  rooms: {
    file: "rooms_import.xlsx",
    sheet: "Rooms",
    columns: ["room_code", "room_name", "room_type", "capacity", "is_virtual", "campus_mode", "recording_available"],
  },
  staff: {
    file: "staff_import.xlsx",
    sheet: "Staff",
    columns: ["staff_id", "staff_name", "staff_host_key"],
  },
  modules: {
    file: "modules_import.xlsx",
    sheet: "Modules",
    columns: ["module_code", "module_host_key", "module_title", "term"],
  },
  programmes: {
    file: "programmes_import.xlsx",
    sheet: "Programmes",
    columns: ["code", "name", "cluster"],
  },
};

const combinedSheets = [
  {
    name: "Rooms",
    rows: payload.rooms,
    columns: uploadConfigs.rooms.columns,
  },
  {
    name: "Staff",
    rows: payload.staff,
    columns: uploadConfigs.staff.columns,
  },
  {
    name: "Modules",
    rows: payload.modules,
    columns: uploadConfigs.modules.columns,
  },
  {
    name: "Programmes",
    rows: payload.programmes,
    columns: uploadConfigs.programmes.columns,
  },
  {
    name: "Common Modules",
    rows: payload.common_modules,
    columns: ["module", "year", "programmes", "remarks"],
  },
  {
    name: "Common Module Map",
    rows: payload.common_module_mappings,
    columns: ["module_code", "year", "programme", "source_programmes_text", "remarks"],
  },
  {
    name: "Excluded Rows",
    rows: payload.excluded_rows,
    columns: ["source_sheet", "source_row", "record_key", "reason"],
  },
  {
    name: "Cleanup Notes",
    rows: payload.cleanup_notes,
    columns: ["item", "value"],
  },
];

function asCell(value) {
  if (value === undefined || value === null) return null;
  return value;
}

function matrix(rows, columns) {
  return [columns, ...rows.map((row) => columns.map((column) => asCell(row[column])))];
}

function columnWidth(column, rows) {
  const maxLen = Math.max(
    column.length,
    ...rows.slice(0, 200).map((row) => String(row[column] ?? "").length),
  );
  return Math.max(80, Math.min(340, maxLen * 8 + 22));
}

function addDataSheet(workbook, sheetName, rows, columns, options = {}) {
  const sheet = workbook.worksheets.add(sheetName);
  sheet.showGridLines = false;
  const data = matrix(rows, columns);
  const range = sheet.getRangeByIndexes(0, 0, data.length, columns.length);
  range.values = data;
  const header = sheet.getRangeByIndexes(0, 0, 1, columns.length);
  header.format = {
    fill: "#0F766E",
    font: { bold: true, color: "#FFFFFF" },
    wrapText: true,
  };
  range.format = {
    font: { color: "#1F2937" },
    wrapText: false,
  };
  header.format = {
    fill: "#0F766E",
    font: { bold: true, color: "#FFFFFF" },
    wrapText: true,
  };
  sheet.freezePanes.freezeRows(1);
  columns.forEach((column, index) => {
    sheet.getRangeByIndexes(0, index, Math.max(1, data.length), 1).format.columnWidthPx = columnWidth(column, rows);
  });
  if (options.note) {
    const noteRow = data.length + 2;
    const noteRange = sheet.getRangeByIndexes(noteRow, 0, 1, Math.min(columns.length, 4));
    noteRange.values = [[options.note, ...Array(Math.min(columns.length, 4) - 1).fill(null)]];
    noteRange.format = {
      fill: "#F8FAFC",
      font: { italic: true, color: "#475569" },
      wrapText: true,
    };
  }
  return sheet;
}

async function saveWorkbook(workbook, filename) {
  const output = await SpreadsheetFile.exportXlsx(workbook);
  const filePath = path.join(outputDir, filename);
  await output.save(filePath);
  return filePath;
}

async function buildSingleUploadFile(config, rows) {
  const workbook = Workbook.create();
  addDataSheet(workbook, config.sheet, rows, config.columns);
  return saveWorkbook(workbook, config.file);
}

const generated = [];
for (const [key, config] of Object.entries(uploadConfigs)) {
  generated.push(await buildSingleUploadFile(config, payload[key]));
}

const combinedWorkbook = Workbook.create();
for (const sheet of combinedSheets) {
  addDataSheet(combinedWorkbook, sheet.name, sheet.rows, sheet.columns);
}
generated.unshift(await saveWorkbook(combinedWorkbook, "cleaned_raw_data_combined.xlsx"));

const preview = await combinedWorkbook.render({
  sheetName: "Cleanup Notes",
  autoCrop: "all",
  scale: 1,
  format: "png",
});
await fs.writeFile(
  path.join(outputDir, "cleanup_notes_preview.png"),
  new Uint8Array(await preview.arrayBuffer()),
);

await fs.writeFile(
  path.join(outputDir, "generated_files.json"),
  JSON.stringify({ generated }, null, 2),
  "utf8",
);

console.log(JSON.stringify({ generated }, null, 2));
