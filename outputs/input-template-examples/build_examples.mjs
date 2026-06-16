import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "C:/Users/Admin/Desktop/Code/Codes/INF1009/ITP/outputs/input-template-examples";

const requiredHeaders = [
  "Requirement ID",
  "Programme",
  "Year",
  "Module Code",
  "Class Type",
  "Session Count",
  "Duration Hours",
  "Sessions Per Week",
  "Delivery Mode",
  "Venue Type Required",
  "Exact Class Size",
  "Staff 1 Name",
  "Staff 1 ID",
  "Staff 2 Name",
  "Staff 2 ID",
  "Staff 3 Name",
  "Staff 3 ID",
  "Staff 4 Name",
  "Staff 4 ID",
];

const optionalHeaders = [
  "Requirement ID",
  "Start Week",
  "End Week",
  "Specific Week",
  "Specific Date",
  "Specific Day",
  "Start Time",
  "End Time",
  "Venue Request",
  "Shared Session Group ID",
  "Combined With Programmes",
  "Cleanup Notes",
];

const readmeRows = [
  ["Purpose", "These are small examples for the new two-tab timetable input template."],
  ["Required tab", "Input_Template contains the official required fields."],
  ["Optional tab", "Remarks_(optional) contains optional overrides joined only by Requirement ID."],
  ["Defaults", "Leave optional cells blank to use defaults: weeks 1-13, flexible weekly scheduling, no fixed day/time/date."],
  ["Staff", "Staff 1 ID is required. Staff 2-4 are co-teachers; a filled co-teacher must include an ID."],
];

const examples = [
  {
    fileName: "working_two_tab_input_template.xlsx",
    title: "Working Example",
    note: "Valid import shape with blank defaults, one fixed tutorial, one co-taught lecture, and one specific-week row.",
    requiredRows: [
      ["WORK-001", "DSC", 1, "DSC1001", "Lecture", 1, 2, 1, "Online", "Virtual", 80, "LIN WEIDONG", "A100909", "", "", "", "", "", ""],
      ["WORK-002", "DSC", 1, "DSC1001", "Tutorial", 1, 2, 1, "Online", "Virtual", 40, "YANG SHANSHAN", "H51683", "", "", "", "", "", ""],
      ["WORK-003", "DSC", 2, "DSC2302", "Lecture", 1, 2, 1, "Online", "Virtual", 70, "TAN MEOW LOONG", "H51681", "WANG FENGYU", "H51493", "", "", "", ""],
      ["WORK-004", "METS", 2, "MET2602", "Tutorial", 1, 2, 1, "Online", "Virtual", 35, "KAN HWA HENG", "H51301", "", "", "", "", "", ""],
    ],
    optionalRows: [
      ["WORK-001", 1, 13, "", "", "Monday", "10:00", "12:00", "", "", "", ""],
      ["WORK-002", 1, 13, "", "", "Tuesday", "10:00", "12:00", "", "", "", ""],
      ["WORK-003", 1, 13, "", "", "Monday", "14:00", "16:00", "", "", "", ""],
      ["WORK-004", "", "", 5, "", "Tuesday", "14:00", "16:00", "", "", "", ""],
    ],
  },
  {
    fileName: "hard_conflicts_two_tab_input_template.xlsx",
    title: "Hard Conflict Example",
    note: "Imports cleanly, then should show hard conflicts because staff and co-teachers are double-booked at fixed overlapping times.",
    requiredRows: [
      ["HARD-001", "DSC", 1, "DSC1001", "Lecture", 1, 2, 1, "Face-to-face", "Classroom", 40, "LIN WEIDONG", "A100909", "", "", "", "", "", ""],
      ["HARD-002", "DSC", 1, "DSC2302", "Tutorial", 1, 2, 1, "Face-to-face", "Classroom", 35, "LIN WEIDONG", "A100909", "", "", "", "", "", ""],
      ["HARD-003", "METS", 2, "MET2602", "Tutorial", 1, 2, 1, "Face-to-face", "Classroom", 35, "YANG SHANSHAN", "H51683", "TAN MEOW LOONG", "H51681", "", "", "", ""],
      ["HARD-004", "DSC", 3, "DSC3002B", "Tutorial", 1, 2, 1, "Face-to-face", "Classroom", 35, "WANG FENGYU", "H51493", "TAN MEOW LOONG", "H51681", "", "", "", ""],
    ],
    optionalRows: [
      ["HARD-001", 1, 13, "", "", "Monday", "09:00", "11:00", "", "", "", ""],
      ["HARD-002", 1, 13, "", "", "Monday", "09:00", "11:00", "", "", "", ""],
      ["HARD-003", 1, 13, "", "", "Tuesday", "09:00", "11:00", "", "", "", ""],
      ["HARD-004", 1, 13, "", "", "Tuesday", "09:00", "11:00", "", "", "", ""],
    ],
  },
  {
    fileName: "soft_conflicts_two_tab_input_template.xlsx",
    title: "Soft Conflict Example",
    note: "Imports cleanly and is schedulable, but should produce soft warnings for online sessions outside Mon/Tue and low physical room utilisation.",
    requiredRows: [
      ["SOFT-001", "DSC", 1, "DSC1001", "Lecture", 1, 2, 1, "Online", "Virtual", 80, "LIN WEIDONG", "A100909", "", "", "", "", "", ""],
      ["SOFT-002", "DSC", 2, "DSC2302", "Lecture", 1, 2, 1, "Online", "Virtual", 70, "YANG SHANSHAN", "H51683", "", "", "", "", "", ""],
      ["SOFT-003", "METS", 2, "MET2602", "Tutorial", 1, 2, 1, "Face-to-face", "Classroom", 20, "KAN HWA HENG", "H51301", "", "", "", "", "", ""],
      ["SOFT-004", "DSC", 3, "DSC3002B", "Tutorial", 1, 2, 1, "Face-to-face", "Classroom", 35, "WANG FENGYU", "H51493", "", "", "", "", "", ""],
    ],
    optionalRows: [
      ["SOFT-001", 1, 13, "", "", "Wednesday", "09:00", "11:00", "", "", "", ""],
      ["SOFT-002", 1, 13, "", "", "Thursday", "09:00", "11:00", "", "", "", ""],
      ["SOFT-003", 1, 13, "", "", "Monday", "09:00", "11:00", "", "", "", ""],
      ["SOFT-004", "", "", "", "", "", "", "", "", "", "", ""],
    ],
  },
];

function colLetter(index) {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function writeSheet(sheet, title, note, headers, rows) {
  const lastCol = colLetter(headers.length - 1);
  sheet.getRangeByIndexes(0, 0, 1, headers.length).values = [headers];
  sheet.getRangeByIndexes(1, 0, rows.length, headers.length).values = rows;

  sheet.getRangeByIndexes(0, 0, 1, headers.length).format = {
    fill: "#D9EAF7",
    font: { bold: true, color: "#111827" },
    wrapText: true,
    borders: { preset: "all", style: "thin", color: "#B7C9D6" },
  };
  sheet.getRangeByIndexes(1, 0, rows.length, headers.length).format = {
    borders: { preset: "all", style: "thin", color: "#D9E2EC" },
    wrapText: true,
  };
  sheet.freezePanes.freezeRows(1);

  for (let c = 0; c < headers.length; c += 1) {
    sheet.getRangeByIndexes(0, c, rows.length + 1, 1).format.columnWidthPx = c === 0 ? 128 : 116;
  }
  sheet.getRangeByIndexes(0, headers.length - 1, rows.length + 1, 1).format.columnWidthPx = 240;
}

async function buildExample(example) {
  const workbook = Workbook.create();
  const input = workbook.worksheets.add("Input_Template");
  const optional = workbook.worksheets.add("Remarks_(optional)");
  const readme = workbook.worksheets.add("README");

  writeSheet(input, example.title, example.note, requiredHeaders, example.requiredRows);
  writeSheet(optional, example.title, example.note, optionalHeaders, example.optionalRows);
  writeSheet(readme, example.title, example.note, ["Field", "Guidance"], readmeRows);

  const errorScan = await workbook.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 20 },
    summary: "formula error scan",
  });
  console.log(`${example.fileName} error scan: ${errorScan.ndjson}`);

  for (const sheetName of ["Input_Template", "Remarks_(optional)", "README"]) {
    const preview = await workbook.render({
      sheetName,
      autoCrop: "all",
      scale: 1,
      format: "png",
    });
    const bytes = new Uint8Array(await preview.arrayBuffer());
    await fs.writeFile(path.join(outputDir, `${example.fileName.replace(".xlsx", "")}_${sheetName}.png`), bytes);
  }

  const xlsx = await SpreadsheetFile.exportXlsx(workbook);
  await xlsx.save(path.join(outputDir, example.fileName));
}

await fs.mkdir(outputDir, { recursive: true });
for (const example of examples) {
  await buildExample(example);
}

console.log("Created example input files.");
