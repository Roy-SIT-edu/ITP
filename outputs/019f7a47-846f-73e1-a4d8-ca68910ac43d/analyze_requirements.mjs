import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputDir = path.resolve(process.argv[2]);
const outputDir = path.resolve(process.argv[3]);
await fs.mkdir(outputDir, { recursive: true });

const files = (await fs.readdir(inputDir))
  .filter((name) => name.toLowerCase().endsWith(".xlsx"))
  .sort((a, b) => a.localeCompare(b));

const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const headerSignals = [
  "prog", "programme", "year", "class size", "module", "activity", "class type",
  "delivery", "teaching week", "staff", "staff id", "duration", "session", "venue",
  "campus", "student group", "partition", "remark", "fixed", "day", "time",
];

const result = { generatedAt: new Date().toISOString(), inputDir, workbookCount: files.length, workbooks: [] };

for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
  const file = files[fileIndex];
  const absolute = path.join(inputDir, file);
  const stat = await fs.stat(absolute);
  console.log(`[${fileIndex + 1}/${files.length}] ${file}`);
  const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(absolute));
  const sheetsInspection = await wb.inspect({ kind: "sheet", include: "id,name", maxChars: 30000 });
  const sheetRecords = sheetsInspection.ndjson
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.kind === "sheet");

  const workbookRecord = { file, absolute, sizeBytes: stat.size, sheets: [] };
  for (const sheetRecord of sheetRecords) {
    const sheet = wb.resolve(sheetRecord.id);
    const used = sheet.getUsedRange();
    const values = used ? used.values : [];
    const formulas = used ? used.formulas : [];
    const rows = Array.isArray(values) ? values.length : 0;
    const cols = rows ? Math.max(...values.map((row) => Array.isArray(row) ? row.length : 0)) : 0;
    const headerCandidates = [];
    for (let r = 0; r < Math.min(rows, 60); r += 1) {
      const row = values[r] ?? [];
      const normalizedCells = row.map((cell) => normalize(cell).toLowerCase());
      const signalHits = normalizedCells.reduce((count, cell) => count + headerSignals.filter((signal) => cell.includes(signal)).length, 0);
      const populated = normalizedCells.filter(Boolean).length;
      if (signalHits >= 2 || (signalHits >= 1 && populated >= 4)) {
        headerCandidates.push({ row: r + 1, signalHits, populated, values: row.map(normalize) });
      }
    }
    workbookRecord.sheets.push({
      id: sheetRecord.id,
      name: sheetRecord.name,
      index: sheetRecord.index,
      address: sheetRecord.address ?? sheetRecord.range ?? null,
      rows,
      cols,
      headerCandidates,
      values,
      formulas,
    });
  }
  result.workbooks.push(workbookRecord);
}

await fs.writeFile(path.join(outputDir, "requirements_analysis.json"), JSON.stringify(result, null, 2));
console.log(`Saved ${path.join(outputDir, "requirements_analysis.json")}`);

const representativeFiles = [
  "Requirements Template_ENG.xlsx",
  "Requirements Template_Lab (ENG) - AY25 Tri 1.xlsx",
  "SBE Year 1.xlsx",
  "MEC_Year 1_2510 Requirements.xlsx",
  "EDE Requirements Template_20 May 2025_2510 _V.xlsx",
  "TT Requirements_EEE ISE PET_2510_v2.xlsx",
  "SDE Timetable Requirements (2510).xlsx",
  "Requirements Template CVE 5 May 25 -revised.xlsx",
];

for (const file of representativeFiles) {
  if (!files.includes(file)) continue;
  const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(path.join(inputDir, file)));
  const sheetsInspection = await wb.inspect({ kind: "sheet", include: "id,name", maxChars: 30000 });
  const sheetRecords = sheetsInspection.ndjson
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.kind === "sheet");
  const target = sheetRecords.find((entry) => /module|requirement|input|lab/i.test(entry.name)) ?? sheetRecords[0];
  if (!target) continue;
  const crop = target.address ?? target.range ?? "A1:M30";
  console.log(`Rendering ${file} :: ${target.name} (${crop})`);
  const preview = await wb.render({ sheetName: target.name, range: crop, scale: 1, format: "png" });
  const safe = file.replace(/\.xlsx$/i, "").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  await fs.writeFile(path.join(outputDir, `${safe}__${target.name.replace(/[^a-z0-9]+/gi, "_")}.png`), new Uint8Array(await preview.arrayBuffer()));
}

console.log("Representative renders complete.");
