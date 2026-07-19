import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const __filename = fileURLToPath(import.meta.url);
const outputDir = path.dirname(__filename);
const repoRoot = path.resolve(outputDir, "..", "..");
const historicalDir = path.join(repoRoot, "ITP Programming App 2", "Data", "Requirements_ENG");
const backendRoot = path.join(repoRoot, "ITP Programming App 2", "timetable-app", "backend");
const backendDataDir = path.join(backendRoot, "data");
const labSeedPath = path.join(backendRoot, "app", "data", "lab_requirements_seed.json");
const inventoryPath = path.join(outputDir, "requirements_eng_inventory.json");
const preparedDataPath = path.join(outputDir, "prepared_realistic_data.json");
const prepareScriptPath = path.join(outputDir, "prepare_realistic_template_data.py");
const verifyScriptPath = path.join(outputDir, "verify_realistic_template.py");
const outputPath = path.join(outputDir, "realistic_validated_20_programme_input_template.xlsx");
const bundledPython = process.env.CODEX_BUNDLED_PYTHON
  ?? "C:\\Users\\Admin\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const backendPython = process.env.BACKEND_PYTHON
  ?? path.join(backendRoot, "venv", "Scripts", "python.exe");

function parseNdjson(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function clean(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text && !["nan", "none", "null"].includes(text.toLowerCase()) ? text : null;
}

function headerToken(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function columnIndex(headers, aliases) {
  const tokens = headers.map(headerToken);
  for (const alias of aliases) {
    const index = tokens.indexOf(headerToken(alias));
    if (index >= 0) return index;
  }
  return -1;
}

function extractRows(filename, table) {
  const values = table.values ?? [];
  const headerIndex = values.findIndex((row) => {
    const tokens = row.map(headerToken);
    return tokens.includes("module code") && (tokens.includes("activity") || tokens.includes("class type"));
  });
  if (headerIndex < 0) return [];

  const headers = values[headerIndex];
  const indices = {
    programme: columnIndex(headers, ["Prog/Yr", "Programme/Year", "Programme", "Program/Year"]),
    classSize: columnIndex(headers, ["Class Size", "Cohort Size", "No. of Students"]),
    moduleCode: columnIndex(headers, ["Module Code", "Module"]),
    activity: columnIndex(headers, ["Activity", "Class Type"]),
    deliveryMode: columnIndex(headers, ["Delivery Mode", "Mode"]),
    teachingWeeks: columnIndex(headers, ["Teaching Weeks", "Weeks"]),
    staff1: columnIndex(headers, ["Staff 1", "Staff 1 Name"]),
    staffId1: columnIndex(headers, ["Staff ID 1", "Staff 1 ID"]),
    staff2: columnIndex(headers, ["Staff 2", "Staff 2 Name"]),
    staffId2: columnIndex(headers, ["Staff ID 2", "Staff 2 ID"]),
    staff3: columnIndex(headers, ["Staff 3", "Staff 3 Name"]),
    staffId3: columnIndex(headers, ["Staff ID 3", "Staff 3 ID"]),
    staff4: columnIndex(headers, ["Staff 4", "Staff 4 Name"]),
    staffId4: columnIndex(headers, ["Staff ID 4", "Staff 4 ID"]),
    remarks: columnIndex(headers, ["Remarks", "Remark", "Comments"]),
    startAt7: columnIndex(headers, ["Start at 7pm?"]),
  };

  const get = (row, index) => (index >= 0 ? clean(row[index]) : null);
  const rows = [];
  let programme = null;
  let classSize = null;
  let moduleCode = null;
  for (let index = headerIndex + 1; index < values.length; index += 1) {
    const row = values[index] ?? [];
    programme = get(row, indices.programme) ?? programme;
    classSize = get(row, indices.classSize) ?? classSize;
    moduleCode = get(row, indices.moduleCode) ?? moduleCode;
    const activity = get(row, indices.activity);
    if (!moduleCode || !activity) continue;
    rows.push({
      source_file: filename,
      source_sheet: table.sheet,
      source_row: headerIndex + 2 + (index - headerIndex),
      programme_year_raw: programme,
      class_size: classSize,
      module_code: moduleCode,
      activity,
      delivery_mode: get(row, indices.deliveryMode),
      teaching_weeks: get(row, indices.teachingWeeks),
      staff: [1, 2, 3, 4]
        .map((number) => ({
          name: get(row, indices[`staff${number}`]),
          id: get(row, indices[`staffId${number}`]),
        }))
        .filter((item) => item.name || item.id),
      remarks: get(row, indices.remarks),
      start_at_7pm: get(row, indices.startAt7),
    });
  }
  return rows;
}

function sanitizeFilename(value) {
  return value.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
}

async function analyzeHistoricalRequirements() {
  await fs.mkdir(outputDir, { recursive: true });
  const filenames = (await fs.readdir(historicalDir))
    .filter((name) => name.toLowerCase().endsWith(".xlsx"))
    .sort((a, b) => a.localeCompare(b));
  const representativeFiles = new Set([
    "Requirements Template_ENG.xlsx",
    "ASE_Year 1_Requirements 2510.xlsx",
    "EPE_Year 1.xlsx",
    "RSE_Year1.xlsx",
    "SBE Year 2.xlsx",
    "TT Requirements_EEE ISE PET_2510_v2.xlsx",
  ]);
  const inventory = [];
  const normalizedRows = [];

  for (let fileIndex = 0; fileIndex < filenames.length; fileIndex += 1) {
    const filename = filenames[fileIndex];
    const fullPath = path.join(historicalDir, filename);
    const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(fullPath));
    const inspection = await workbook.inspect({
      kind: "sheet,table",
      include: "id,name,values,formulas",
      tableMaxRows: 220,
      tableMaxCols: 30,
      tableMaxCellChars: 300,
      maxChars: 250000,
    });
    const records = parseNdjson(inspection.ndjson);
    const sheets = records.filter((item) => item.kind === "sheet");
    const tables = records.filter((item) => item.kind === "table");
    const extracted = tables.flatMap((table) => extractRows(filename, table));
    normalizedRows.push(...extracted);
    inventory.push({
      filename,
      sheet_count: sheets.length,
      sheets: sheets.map((sheet) => ({ name: sheet.name, range: sheet.range ?? sheet.address })),
      detected_requirement_rows: extracted.length,
      detected_requirement_sheets: [...new Set(extracted.map((row) => row.source_sheet))],
      tables,
    });

    if (representativeFiles.has(filename)) {
      const target = tables.find((table) => extractRows(filename, table).length > 0) ?? tables[0];
      if (target) {
        const [start, end] = String(target.address).split(":");
        const endColumn = (end?.match(/[A-Z]+/i) ?? ["R"])[0];
        const previewRange = `${start ?? "A1"}:${endColumn}35`;
        const preview = await workbook.render({
          sheetName: target.sheet,
          range: previewRange,
          scale: 1,
          format: "png",
        });
        await fs.writeFile(
          path.join(outputDir, `historical_${sanitizeFilename(filename)}_${sanitizeFilename(target.sheet)}.png`),
          new Uint8Array(await preview.arrayBuffer()),
        );
      }
    }
    console.log(`${fileIndex + 1}/${filenames.length} ${filename}: ${extracted.length} requirement rows`);
  }

  const summary = {
    workbook_count: inventory.length,
    normalized_requirement_row_count: normalizedRows.length,
    activities: [...new Set(normalizedRows.map((row) => row.activity).filter(Boolean))].sort(),
    delivery_modes: [...new Set(normalizedRows.map((row) => row.delivery_mode).filter(Boolean))].sort(),
    source_files_with_rows: inventory.filter((item) => item.detected_requirement_rows > 0).map((item) => item.filename),
  };
  await fs.writeFile(
    path.join(outputDir, "requirements_eng_inventory.json"),
    JSON.stringify({ summary, inventory, normalizedRows }, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
}

const inputColumns = [
  "Requirement ID",
  "Programme",
  "Year",
  "Student Group Code",
  "Module Code",
  "Module Title",
  "Class Type",
  "Session Count",
  "Duration Hours",
  "Sessions Per Week",
  "Delivery Mode",
  "Venue Type Required",
  "Campus Mode",
  "Exact Class Size",
  "Staff 1 Name",
  "Staff 1 ID",
  "Staff 2 Name",
  "Staff 2 ID",
  "Staff 3 Name",
  "Staff 3 ID",
  "Staff 4 Name",
  "Staff 4 ID",
  "Source File",
  "Source Row No",
];

const optionalColumns = [
  "Requirement ID",
  "Start Week",
  "End Week",
  "Week Pattern",
  "Custom Weeks",
  "Scheduling Type",
  "Preferred Days",
  "Avoid Days",
  "Fixed Day",
  "Fixed Start Time",
  "Fixed End Time",
  "Priority",
  "Common Module?",
  "Shared Session Group ID",
  "Combined With Programmes",
  "Hard Constraint Notes",
  "Soft Preference Notes",
  "Remarks",
];

const pastelBands = ["#DDEBF7", "#E2F0D9", "#FCE4D6", "#E4DFEC", "#FFF2CC"];

function runPython(executable, scriptPath, args, timeout = 30_000) {
  const result = spawnSync(executable, [scriptPath, ...args], {
    cwd: outputDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout,
  });
  if (result.status !== 0) {
    throw new Error(
      `Python task failed (${path.basename(scriptPath)}).\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function matrixFromRows(rows, columns) {
  return [columns, ...rows.map((row) => columns.map((column) => row[column] ?? null))];
}

function setColumnWidths(sheet, widths, rowCount) {
  widths.forEach((width, index) => {
    sheet.getRangeByIndexes(0, index, rowCount, 1).format.columnWidth = width;
  });
}

function applyTableBorders(range, color = "#7F7F7F") {
  range.format.borders = {
    insideHorizontal: { style: "thin", color },
    insideVertical: { style: "thin", color },
    top: { style: "thin", color },
    bottom: { style: "thin", color },
    left: { style: "thin", color },
    right: { style: "thin", color },
  };
}

function styleRequirementSheet(sheet, matrix, widths, freezeColumns) {
  const rowCount = matrix.length;
  const columnCount = matrix[0].length;
  const used = sheet.getRangeByIndexes(0, 0, rowCount, columnCount);
  used.values = matrix;
  used.format = {
    font: { name: "Calibri", size: 10, color: "#1F1F1F" },
    verticalAlignment: "center",
  };
  used.format.rowHeight = 22;
  applyTableBorders(used, "#808080");
  const header = sheet.getRangeByIndexes(0, 0, 1, columnCount);
  header.format = {
    fill: "#FFF200",
    font: { name: "Calibri", size: 10, bold: true, color: "#000000" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
  };
  header.format.rowHeight = 42;
  setColumnWidths(sheet, widths, rowCount);
  sheet.freezePanes.freezeRows(1);
  if (freezeColumns) sheet.freezePanes.freezeColumns(freezeColumns);
  sheet.showGridLines = false;
}

function applyModuleBands(sheet, requiredRows, columnCount) {
  let startIndex = 0;
  let bandIndex = 0;
  while (startIndex < requiredRows.length) {
    const key = `${requiredRows[startIndex]["Programme"]}|${requiredRows[startIndex]["Module Code"]}`;
    let endIndex = startIndex + 1;
    while (
      endIndex < requiredRows.length
      && `${requiredRows[endIndex]["Programme"]}|${requiredRows[endIndex]["Module Code"]}` === key
    ) {
      endIndex += 1;
    }
    const range = sheet.getRangeByIndexes(startIndex + 1, 0, endIndex - startIndex, columnCount);
    range.format.fill = pastelBands[bandIndex % pastelBands.length];
    range.format.borders = {
      top: { style: "medium", color: "#5B5B5B" },
      bottom: { style: "thin", color: "#808080" },
      insideHorizontal: { style: "thin", color: "#A6A6A6" },
      insideVertical: { style: "thin", color: "#A6A6A6" },
      left: { style: "thin", color: "#808080" },
      right: { style: "thin", color: "#808080" },
    };
    startIndex = endIndex;
    bandIndex += 1;
  }
}

function styleSectionTitle(sheet, rangeAddress, title, fill) {
  const range = sheet.getRange(rangeAddress);
  range.merge();
  sheet.getRange(rangeAddress.split(":")[0]).values = [[title]];
  range.format = {
    fill,
    font: { name: "Calibri", size: 15, bold: true, color: "#FFFFFF" },
    verticalAlignment: "center",
  };
  range.format.rowHeight = 32;
}

function styleCompactTable(sheet, rangeAddress, headerRowAddress, widths) {
  const tableRange = sheet.getRange(rangeAddress);
  tableRange.format = {
    font: { name: "Calibri", size: 10, color: "#1F1F1F" },
    verticalAlignment: "center",
  };
  tableRange.format.rowHeight = 22;
  applyTableBorders(tableRange, "#A6A6A6");
  const header = sheet.getRange(headerRowAddress);
  header.format = {
    fill: "#4472C4",
    font: { name: "Calibri", size: 10, bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
  };
  header.format.rowHeight = 34;
  setColumnWidths(sheet, widths, tableRange.rowCount ?? 120);
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(Number.parseInt(headerRowAddress.match(/\d+/)?.[0] ?? "1", 10));
}

async function buildWorkbook() {
  try {
    await fs.access(inventoryPath);
  } catch {
    await analyzeHistoricalRequirements();
  }

  const preparedText = runPython(
    bundledPython,
    prepareScriptPath,
    [backendDataDir, inventoryPath, labSeedPath],
    60_000,
  );
  const data = JSON.parse(preparedText);
  await fs.writeFile(preparedDataPath, JSON.stringify(data, null, 2));

  const workbook = Workbook.create();
  const inputSheet = workbook.worksheets.add("Input_Template");
  const optionalSheet = workbook.worksheets.add("Remarks_(optional)");
  const programmeSheet = workbook.worksheets.add("Programme_Summary");
  const auditSheet = workbook.worksheets.add("Source_Audit");
  const qualitySheet = workbook.worksheets.add("Quality_Check");
  const readmeSheet = workbook.worksheets.add("README");

  const inputMatrix = matrixFromRows(data.required, inputColumns);
  const optionalMatrix = matrixFromRows(data.optional, optionalColumns);
  const inputEndRow = inputMatrix.length;
  const optionalEndRow = optionalMatrix.length;

  styleRequirementSheet(
    inputSheet,
    inputMatrix,
    [25, 11, 7, 18, 15, 22, 13, 12, 13, 16, 16, 20, 13, 15, 29, 13, 25, 13, 25, 13, 25, 13, 50, 13],
    5,
  );
  applyModuleBands(inputSheet, data.required, inputColumns.length);
  inputSheet.getRange(`A2:A${inputEndRow}`).format.font = { bold: true, color: "#1F4E78" };
  inputSheet.getRange(`B2:B${inputEndRow}`).format.font = { bold: true, color: "#1F1F1F" };
  inputSheet.getRange(`E2:E${inputEndRow}`).format = {
    fill: "#F8CBAD",
    font: { bold: true, color: "#7F4125" },
  };
  inputSheet.getRange(`F2:F${inputEndRow}`).format.wrapText = true;
  inputSheet.getRange(`O2:U${inputEndRow}`).format.wrapText = true;
  inputSheet.getRange(`W2:W${inputEndRow}`).format.wrapText = true;
  for (let rowIndex = 0; rowIndex < data.required.length; rowIndex += 1) {
    const excelRow = rowIndex + 2;
    if (["Online", "Asynchronous"].includes(data.required[rowIndex]["Delivery Mode"])) {
      inputSheet.getRange(`K${excelRow}:M${excelRow}`).format = {
        fill: "#E4DFEC",
        font: { bold: true, color: "#4C2A69" },
      };
    }
    if (data.required[rowIndex]["Class Type"] === "Quiz") {
      inputSheet.getRange(`G${excelRow}:I${excelRow}`).format.fill = "#FFF2CC";
    }
  }

  inputSheet.getRange(`C2:C${inputEndRow}`).format.numberFormat = "0";
  inputSheet.getRange(`H2:H${inputEndRow}`).format.numberFormat = "0";
  inputSheet.getRange(`I2:I${inputEndRow}`).format.numberFormat = "0.0";
  inputSheet.getRange(`J2:J${inputEndRow}`).format.numberFormat = "0";
  inputSheet.getRange(`N2:N${inputEndRow}`).format.numberFormat = "0";
  inputSheet.getRange(`X2:X${inputEndRow}`).format.numberFormat = "0";
  inputSheet.getRange(`C2:C${inputEndRow}`).dataValidation = {
    rule: { type: "whole", operator: "between", formula1: 1, formula2: 4 },
  };
  inputSheet.getRange(`G2:G${inputEndRow}`).dataValidation = {
    rule: { type: "list", values: ["Lecture", "Lectorial", "Tutorial", "Workshop", "Seminar", "Quiz"] },
  };
  inputSheet.getRange(`H2:H${inputEndRow}`).dataValidation = {
    rule: { type: "whole", operator: "between", formula1: 1, formula2: 5 },
  };
  inputSheet.getRange(`I2:I${inputEndRow}`).dataValidation = {
    rule: { type: "list", values: [1, 1.5, 2, 2.5, 3, 4, 5] },
  };
  inputSheet.getRange(`J2:J${inputEndRow}`).dataValidation = {
    rule: { type: "whole", operator: "between", formula1: 1, formula2: 5 },
  };
  inputSheet.getRange(`K2:K${inputEndRow}`).dataValidation = {
    rule: { type: "list", values: ["Face-to-face", "Online", "Hybrid", "Asynchronous"] },
  };
  inputSheet.getRange(`L2:L${inputEndRow}`).dataValidation = {
    rule: { type: "list", values: ["Lectorial", "Seminar Room", "Virtual"] },
  };
  inputSheet.getRange(`M2:M${inputEndRow}`).dataValidation = {
    rule: { type: "list", values: ["Physical", "Virtual"] },
  };
  inputSheet.getRange(`N2:N${inputEndRow}`).dataValidation = {
    rule: { type: "whole", operator: "between", formula1: 1, formula2: 999 },
  };

  styleRequirementSheet(
    optionalSheet,
    optionalMatrix,
    [25, 11, 11, 14, 22, 18, 18, 16, 14, 17, 16, 12, 18, 27, 28, 34, 34, 42],
    1,
  );
  applyModuleBands(optionalSheet, data.required, optionalColumns.length);
  optionalSheet.getRange(`A2:A${optionalEndRow}`).format.font = { bold: true, color: "#1F4E78" };
  optionalSheet.getRange(`E2:E${optionalEndRow}`).format.wrapText = true;
  optionalSheet.getRange(`N2:R${optionalEndRow}`).format.wrapText = true;
  optionalSheet.getRange(`B2:C${optionalEndRow}`).format.numberFormat = "0";
  optionalSheet.getRange(`B2:C${optionalEndRow}`).dataValidation = {
    rule: { type: "whole", operator: "between", formula1: 1, formula2: 13 },
  };
  optionalSheet.getRange(`D2:D${optionalEndRow}`).dataValidation = {
    rule: { type: "list", values: ["Weekly", "Odd", "Even", "Custom"] },
  };
  optionalSheet.getRange(`F2:F${optionalEndRow}`).dataValidation = {
    rule: { type: "list", values: ["Flexible", "Fixed"] },
  };
  optionalSheet.getRange(`L2:L${optionalEndRow}`).dataValidation = {
    rule: { type: "list", values: ["Low", "Normal", "High", "Hard"] },
  };

  styleSectionTitle(programmeSheet, "A1:I1", "20-Programme Coverage Summary", "#2F75B5");
  const programmeHeaders = [
    "Programme",
    "Distinct Modules Present",
    "Module 1",
    "Module 2",
    "Module 3",
    "Module 4",
    "Module 5",
    "Requirement Rows",
    "Status",
  ];
  const programmeRows = data.summary.programmes.map((programme) => [
    programme,
    null,
    ...data.summary.programme_modules[programme],
    null,
    null,
  ]);
  programmeSheet.getRange(`A3:I${programmeRows.length + 3}`).values = [programmeHeaders, ...programmeRows];
  const programmeDataStart = 4;
  const programmeDataEnd = programmeDataStart + programmeRows.length - 1;
  programmeSheet.getRange(`B${programmeDataStart}:B${programmeDataEnd}`).formulas = data.summary.programmes.map((_, index) => {
    const row = programmeDataStart + index;
    return [
      `=IF(COUNTIFS('Input_Template'!$B$2:$B$${inputEndRow},A${row},'Input_Template'!$E$2:$E$${inputEndRow},C${row})>0,1,0)+IF(COUNTIFS('Input_Template'!$B$2:$B$${inputEndRow},A${row},'Input_Template'!$E$2:$E$${inputEndRow},D${row})>0,1,0)+IF(COUNTIFS('Input_Template'!$B$2:$B$${inputEndRow},A${row},'Input_Template'!$E$2:$E$${inputEndRow},E${row})>0,1,0)+IF(COUNTIFS('Input_Template'!$B$2:$B$${inputEndRow},A${row},'Input_Template'!$E$2:$E$${inputEndRow},F${row})>0,1,0)+IF(COUNTIFS('Input_Template'!$B$2:$B$${inputEndRow},A${row},'Input_Template'!$E$2:$E$${inputEndRow},G${row})>0,1,0)`,
    ];
  });
  programmeSheet.getRange(`H${programmeDataStart}:H${programmeDataEnd}`).formulas = data.summary.programmes.map((_, index) => {
    const row = programmeDataStart + index;
    return [`=COUNTIF('Input_Template'!$B$2:$B$${inputEndRow},A${row})`];
  });
  programmeSheet.getRange(`I${programmeDataStart}:I${programmeDataEnd}`).formulas = data.summary.programmes.map((_, index) => {
    const row = programmeDataStart + index;
    return [`=IF(B${row}>=5,"PASS","REVIEW")`];
  });
  styleCompactTable(
    programmeSheet,
    `A3:I${programmeDataEnd}`,
    "A3:I3",
    [14, 22, 16, 16, 16, 16, 16, 18, 14],
  );
  for (let index = 0; index < programmeRows.length; index += 1) {
    programmeSheet.getRange(`A${programmeDataStart + index}:I${programmeDataStart + index}`).format.fill = pastelBands[index % pastelBands.length];
  }
  programmeSheet.getRange(`A${programmeDataStart}:A${programmeDataEnd}`).format.font = { bold: true, color: "#1F4E78" };
  programmeSheet.getRange(`I${programmeDataStart}:I${programmeDataEnd}`).conditionalFormats.add("containsText", {
    text: "PASS",
    format: { fill: "#C6EFCE", font: { bold: true, color: "#006100" } },
  });
  programmeSheet.getRange(`I${programmeDataStart}:I${programmeDataEnd}`).conditionalFormats.add("containsText", {
    text: "REVIEW",
    format: { fill: "#FFC7CE", font: { bold: true, color: "#9C0006" } },
  });

  styleSectionTitle(auditSheet, "A1:N1", "Admin and Historical Source Audit", "#5B4B8A");
  const auditHeaders = [
    "Programme",
    "Year",
    "Admin Student Group",
    "Admin Group Size",
    "Module Code",
    "Module Title",
    "Activity Rows",
    "Historical Basis",
    "Historical Source(s)",
    "Online Delivery Rows",
    "Lab Class Rows",
    "Output Class Size",
    "Admin Alignment",
    "Labs Included?",
  ];
  const auditBaseRows = data.module_audit.map((row) => [
    row["Programme"],
    row["Year"],
    row["Admin Student Group"],
    row["Admin Group Size"],
    row["Module Code"],
    row["Module Title"],
    null,
    row["Historical Basis"],
    row["Historical Source(s)"],
    null,
    null,
    null,
    null,
    null,
  ]);
  const auditStart = 4;
  const auditEnd = auditStart + auditBaseRows.length - 1;
  auditSheet.getRange(`A3:N${auditEnd}`).values = [auditHeaders, ...auditBaseRows];
  auditSheet.getRange(`G${auditStart}:G${auditEnd}`).formulas = auditBaseRows.map((_, index) => {
    const row = auditStart + index;
    return [`=COUNTIFS('Input_Template'!$B$2:$B$${inputEndRow},A${row},'Input_Template'!$E$2:$E$${inputEndRow},E${row})`];
  });
  auditSheet.getRange(`J${auditStart}:J${auditEnd}`).formulas = auditBaseRows.map((_, index) => {
    const row = auditStart + index;
    return [`=COUNTIFS('Input_Template'!$B$2:$B$${inputEndRow},A${row},'Input_Template'!$E$2:$E$${inputEndRow},E${row},'Input_Template'!$K$2:$K$${inputEndRow},"Online")+COUNTIFS('Input_Template'!$B$2:$B$${inputEndRow},A${row},'Input_Template'!$E$2:$E$${inputEndRow},E${row},'Input_Template'!$K$2:$K$${inputEndRow},"Asynchronous")`];
  });
  auditSheet.getRange(`K${auditStart}:K${auditEnd}`).formulas = auditBaseRows.map((_, index) => {
    const row = auditStart + index;
    return [`=COUNTIFS('Input_Template'!$B$2:$B$${inputEndRow},A${row},'Input_Template'!$E$2:$E$${inputEndRow},E${row},'Input_Template'!$G$2:$G$${inputEndRow},"*lab*")`];
  });
  auditSheet.getRange(`L${auditStart}:L${auditEnd}`).formulas = auditBaseRows.map((_, index) => {
    const row = auditStart + index;
    return [`=IF(G${row}=0,0,SUMIFS('Input_Template'!$N$2:$N$${inputEndRow},'Input_Template'!$B$2:$B$${inputEndRow},A${row},'Input_Template'!$E$2:$E$${inputEndRow},E${row})/G${row})`];
  });
  auditSheet.getRange(`M${auditStart}:M${auditEnd}`).formulas = auditBaseRows.map((_, index) => {
    const row = auditStart + index;
    return [`=IF(AND(G${row}>=2,L${row}=D${row}),"PASS","REVIEW")`];
  });
  auditSheet.getRange(`N${auditStart}:N${auditEnd}`).formulas = auditBaseRows.map((_, index) => {
    const row = auditStart + index;
    return [`=IF(K${row}=0,"No","REVIEW")`];
  });
  styleCompactTable(
    auditSheet,
    `A3:N${auditEnd}`,
    "A3:N3",
    [13, 8, 20, 16, 15, 21, 13, 24, 52, 18, 14, 17, 16, 15],
  );
  auditSheet.getRange(`H${auditStart}:I${auditEnd}`).format.wrapText = true;
  auditSheet.getRange(`E${auditStart}:E${auditEnd}`).format = {
    fill: "#F8CBAD",
    font: { bold: true, color: "#7F4125" },
  };
  auditSheet.getRange(`M${auditStart}:M${auditEnd}`).conditionalFormats.add("containsText", {
    text: "PASS",
    format: { fill: "#C6EFCE", font: { bold: true, color: "#006100" } },
  });
  auditSheet.getRange(`M${auditStart}:N${auditEnd}`).conditionalFormats.add("containsText", {
    text: "REVIEW",
    format: { fill: "#FFC7CE", font: { bold: true, color: "#9C0006" } },
  });

  qualitySheet.showGridLines = false;
  styleSectionTitle(qualitySheet, "A1:D1", "Workbook Quality Checks", "#0F6B78");
  qualitySheet.getRange("A3:D3").values = [["Check", "Actual", "Target", "Status"]];
  qualitySheet.getRange("A4:D17").values = [
    ["Overall workbook status", null, "PASS", null],
    ["Programme count", null, 20, null],
    ["Module mapping rows", null, 100, null],
    ["Minimum distinct modules per programme", null, 5, null],
    ["Input requirement rows", null, data.summary.input_row_count, null],
    ["Invalid Online/Lab class types", null, 0, null],
    ["Uploaded lab venue rows", null, 0, null],
    ["P51-P55 student-group rows", null, 0, null],
    ["Blank required-field cells", null, 0, null],
    ["Uploaded fixed scheduling rows", null, 0, null],
    ["Admin-alignment review rows", null, 0, null],
    ["Source-audit lab review rows", null, 0, null],
    ["Online/asynchronous delivery rows", null, "≤20", null],
    ["Exact historical module matches", null, "Information", "INFO"],
  ];
  qualitySheet.getRange("B4:B17").formulas = [
    ["=IF(COUNTIF(D5:D16,\"REVIEW\")=0,\"PASS\",\"REVIEW\")"],
    [`=COUNTA('Programme_Summary'!A${programmeDataStart}:A${programmeDataEnd})`],
    [`=COUNTA('Source_Audit'!E${auditStart}:E${auditEnd})`],
    [`=MIN('Programme_Summary'!B${programmeDataStart}:B${programmeDataEnd})`],
    [`=COUNTA('Input_Template'!A2:A${inputEndRow})`],
    [`=COUNTIF('Input_Template'!G2:G${inputEndRow},"Online")+COUNTIF('Input_Template'!G2:G${inputEndRow},"*lab*")`],
    [`=COUNTIF('Input_Template'!L2:L${inputEndRow},"*lab*")`],
    [`=COUNTIF('Input_Template'!D2:D${inputEndRow},"* P51")+COUNTIF('Input_Template'!D2:D${inputEndRow},"* P52")+COUNTIF('Input_Template'!D2:D${inputEndRow},"* P53")+COUNTIF('Input_Template'!D2:D${inputEndRow},"* P54")+COUNTIF('Input_Template'!D2:D${inputEndRow},"* P55")`],
    [`=COUNTBLANK('Input_Template'!A2:A${inputEndRow})+COUNTBLANK('Input_Template'!B2:B${inputEndRow})+COUNTBLANK('Input_Template'!C2:C${inputEndRow})+COUNTBLANK('Input_Template'!D2:D${inputEndRow})+COUNTBLANK('Input_Template'!E2:E${inputEndRow})+COUNTBLANK('Input_Template'!G2:G${inputEndRow})+COUNTBLANK('Input_Template'!I2:I${inputEndRow})+COUNTBLANK('Input_Template'!J2:J${inputEndRow})+COUNTBLANK('Input_Template'!K2:K${inputEndRow})+COUNTBLANK('Input_Template'!L2:L${inputEndRow})+COUNTBLANK('Input_Template'!M2:M${inputEndRow})+COUNTBLANK('Input_Template'!N2:N${inputEndRow})+COUNTBLANK('Input_Template'!P2:P${inputEndRow})+COUNTBLANK('Remarks_(optional)'!A2:A${optionalEndRow})+COUNTBLANK('Remarks_(optional)'!B2:B${optionalEndRow})+COUNTBLANK('Remarks_(optional)'!C2:C${optionalEndRow})+COUNTBLANK('Remarks_(optional)'!D2:D${optionalEndRow})+COUNTBLANK('Remarks_(optional)'!E2:E${optionalEndRow})+COUNTBLANK('Remarks_(optional)'!F2:F${optionalEndRow})`],
    [`=COUNTIF('Remarks_(optional)'!F2:F${optionalEndRow},"Fixed")`],
    [`=COUNTIF('Source_Audit'!M${auditStart}:M${auditEnd},"REVIEW")`],
    [`=COUNTIF('Source_Audit'!N${auditStart}:N${auditEnd},"REVIEW")`],
    [`=COUNTIF('Input_Template'!K2:K${inputEndRow},"Online")+COUNTIF('Input_Template'!K2:K${inputEndRow},"Asynchronous")`],
    [`=COUNTIF('Source_Audit'!H${auditStart}:H${auditEnd},"Exact historical module")`],
  ];
  qualitySheet.getRange("D4:D17").formulas = [
    ["=B4"],
    ["=IF(B5=C5,\"PASS\",\"REVIEW\")"],
    ["=IF(B6=C6,\"PASS\",\"REVIEW\")"],
    ["=IF(B7>=C7,\"PASS\",\"REVIEW\")"],
    ["=IF(B8=C8,\"PASS\",\"REVIEW\")"],
    ["=IF(B9=C9,\"PASS\",\"REVIEW\")"],
    ["=IF(B10=C10,\"PASS\",\"REVIEW\")"],
    ["=IF(B11=C11,\"PASS\",\"REVIEW\")"],
    ["=IF(B12=C12,\"PASS\",\"REVIEW\")"],
    ["=IF(B13=C13,\"PASS\",\"REVIEW\")"],
    ["=IF(B14=C14,\"PASS\",\"REVIEW\")"],
    ["=IF(B15=C15,\"PASS\",\"REVIEW\")"],
    ["=IF(B16<=20,\"PASS\",\"REVIEW\")"],
    ["=\"INFO\""],
  ];
  styleCompactTable(qualitySheet, "A3:D17", "A3:D3", [44, 18, 16, 15]);
  qualitySheet.getRange("A4:A17").format = { fill: "#DDEBF7", font: { bold: true, color: "#17365D" } };
  qualitySheet.getRange("D4:D16").conditionalFormats.add("containsText", {
    text: "PASS",
    format: { fill: "#C6EFCE", font: { bold: true, color: "#006100" } },
  });
  qualitySheet.getRange("D4:D16").conditionalFormats.add("containsText", {
    text: "REVIEW",
    format: { fill: "#FFC7CE", font: { bold: true, color: "#9C0006" } },
  });
  qualitySheet.getRange("D17").format = { fill: "#D9EAF7", font: { bold: true, color: "#1F4E78" } };

  readmeSheet.showGridLines = false;
  styleSectionTitle(readmeSheet, "A1:F1", "Realistic 20-Programme Timetable Input Template", "#2F6B3C");
  readmeSheet.getRange("A3:F4").merge();
  readmeSheet.getRange("A3").values = [[
    "Built from the historical Requirements_ENG conventions and reconciled to the current admin databases. The upload rows keep each required key explicit so the application can validate them, while the colours and activity blocks mirror the older engineering workbooks.",
  ]];
  readmeSheet.getRange("A3:F4").format = {
    fill: "#E2F0D9",
    font: { size: 11, color: "#274E13" },
    wrapText: true,
    verticalAlignment: "center",
  };
  readmeSheet.getRange("A6:B13").values = [
    ["Workbook self-check", null],
    ["Programmes", null],
    ["Distinct modules per programme", null],
    ["Input requirement rows", null],
    ["Admin student groups", "Only pre-existing full P1 codes are used; P51-P55 are explicitly excluded."],
    ["Class types", "Lecture, Lectorial, Tutorial, Workshop, Seminar, and Quiz only."],
    ["Online handling", "Online/Asynchronous appear only in Delivery Mode; they are never Class Type values."],
    ["Laboratories", "No Lab/Laboratory activity or lab venue is uploaded. Fixed lab requirements remain application-owned."],
  ];
  readmeSheet.getRange("B6:B9").formulas = [
    ["='Quality_Check'!B4"],
    ["='Quality_Check'!B5"],
    ["='Quality_Check'!B7"],
    ["='Quality_Check'!B8"],
  ];
  readmeSheet.getRange("A6:A13").format = {
    fill: "#FFF2CC",
    font: { bold: true, color: "#7F6000" },
  };
  applyTableBorders(readmeSheet.getRange("A6:B13"), "#B7A36A");
  readmeSheet.getRange("B10:B13").format.wrapText = true;
  readmeSheet.getRange("A15:F15").merge();
  readmeSheet.getRange("A15").values = [["How the requirements were made realistic"]];
  readmeSheet.getRange("A15:F15").format = {
    fill: "#4472C4",
    font: { bold: true, color: "#FFFFFF", size: 12 },
  };
  readmeSheet.getRange("A16:F21").merge();
  readmeSheet.getRange("A16").values = [[
    "Each programme has five active term-2520 modules and legitimate admin group sizes. Each module has separate teaching-activity rows, normally a lecture/lectorial or workshop plus a tutorial/seminar; every programme also has a quiz requirement. Numeric teaching weeks follow the common 1-6 and 8-13 pattern unless a usable historical pattern exists. Historical 2 x 2-hour activities are represented as two independently schedulable rows because the application schedules one workbook row at a time. All uploaded rows remain flexible so they can be placed around the fixed labs without introducing hard clashes.",
  ]];
  readmeSheet.getRange("A16:F21").format = {
    fill: "#DDEBF7",
    font: { size: 11, color: "#17365D" },
    wrapText: true,
    verticalAlignment: "top",
  };
  readmeSheet.getRange("A23:F23").merge();
  readmeSheet.getRange("A23").values = [["Upload Input_Template and Remarks_(optional) together through the application's Input Template flow. Programme_Summary, Source_Audit, Quality_Check, and README are supporting sheets and are ignored by the importer."]];
  readmeSheet.getRange("A23:F23").format = {
    fill: "#FCE4D6",
    font: { bold: true, color: "#843C0C" },
    wrapText: true,
  };
  readmeSheet.getRange("A23:F23").format.rowHeight = 42;
  readmeSheet.getRange("A1:A23").format.columnWidth = 32;
  readmeSheet.getRange("B1:B23").format.columnWidth = 88;
  readmeSheet.getRange("C1:F23").format.columnWidth = 10;
  readmeSheet.getRange("A3:F4").format.rowHeight = 28;
  readmeSheet.getRange("A6:B9").format.rowHeight = 28;
  readmeSheet.getRange("A10:B13").format.rowHeight = 46;
  readmeSheet.getRange("A16:F21").format.rowHeight = 24;
  readmeSheet.freezePanes.freezeRows(1);

  const inspections = [];
  for (const [range, maxRows, maxCols] of [
    [`Input_Template!A1:X30`, 30, 24],
    [`Input_Template!A${Math.max(2, inputEndRow - 20)}:X${inputEndRow}`, 22, 24],
    [`Remarks_(optional)!A1:R25`, 25, 18],
    [`Programme_Summary!A1:I${programmeDataEnd}`, programmeDataEnd, 9],
    [`Source_Audit!A1:N${auditEnd}`, auditEnd, 14],
    ["Quality_Check!A1:D17", 17, 4],
    ["README!A1:F23", 23, 6],
  ]) {
    const inspected = await workbook.inspect({
      kind: "table",
      range,
      include: "values,formulas",
      tableMaxRows: maxRows,
      tableMaxCols: maxCols,
      maxChars: 120_000,
    });
    inspections.push(inspected.ndjson);
  }
  const formulaErrors = await workbook.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 200 },
    summary: "formula error scan before export",
  });
  inspections.push(formulaErrors.ndjson);
  await fs.writeFile(path.join(outputDir, "realistic_workbook_inspection.ndjson"), inspections.join("\n"));

  const middleStart = Math.max(2, Math.floor(inputEndRow / 2) - 15);
  const middleEnd = Math.min(inputEndRow, middleStart + 30);
  const previewSpecs = [
    ["Input_Template", "A1:X36", "realistic_preview_input_top.png", 0.9],
    ["Input_Template", `A${middleStart}:X${middleEnd}`, "realistic_preview_input_middle.png", 0.9],
    ["Input_Template", `A${Math.max(2, inputEndRow - 30)}:X${inputEndRow}`, "realistic_preview_input_tail.png", 0.9],
    ["Remarks_(optional)", "A1:R32", "realistic_preview_remarks.png", 1],
    ["Programme_Summary", `A1:I${programmeDataEnd}`, "realistic_preview_programmes.png", 1.1],
    ["Source_Audit", "A1:N54", "realistic_preview_audit_top.png", 0.95],
    ["Source_Audit", `A55:N${auditEnd}`, "realistic_preview_audit_bottom.png", 0.95],
    ["Quality_Check", "A1:D17", "realistic_preview_quality.png", 1.2],
    ["README", "A1:F23", "realistic_preview_readme.png", 1.1],
  ];
  for (const [sheetName, range, filename, scale] of previewSpecs) {
    const preview = await workbook.render({ sheetName, range, scale, format: "png" });
    await fs.writeFile(path.join(outputDir, filename), new Uint8Array(await preview.arrayBuffer()));
  }

  const exported = await SpreadsheetFile.exportXlsx(workbook);
  await exported.save(outputPath);

  const reopened = await SpreadsheetFile.importXlsx(await FileBlob.load(outputPath));
  const reopenedInspection = await reopened.inspect({
    kind: "sheet,table",
    include: "id,name,values,formulas",
    tableMaxRows: 240,
    tableMaxCols: 24,
    tableMaxCellChars: 500,
    maxChars: 450_000,
  });
  const reopenedErrors = await reopened.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 200 },
    summary: "formula error scan after export",
  });
  await fs.writeFile(
    path.join(outputDir, "realistic_exported_workbook_inspection.ndjson"),
    `${reopenedInspection.ndjson}\n${reopenedErrors.ndjson}`,
  );

  let verification = null;
  if (process.env.SKIP_APPLICATION_VALIDATION !== "1") {
    const verificationText = runPython(
      backendPython,
      verifyScriptPath,
      [backendRoot, outputPath, preparedDataPath],
      720_000,
    );
    verification = JSON.parse(verificationText);
  }
  const finalSummary = { ...data.summary, verification };
  if (verification) {
    await fs.writeFile(
      path.join(outputDir, "realistic_validation_summary.json"),
      JSON.stringify(finalSummary, null, 2),
    );
  }
  console.log(JSON.stringify({ outputPath, summary: finalSummary }, null, 2));
}

const mode = process.argv[2] ?? "analyze";
if (mode === "analyze") {
  await analyzeHistoricalRequirements();
} else if (mode === "build") {
  await buildWorkbook();
} else {
  throw new Error(`Unknown mode: ${mode}`);
}
