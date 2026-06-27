import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = process.env.ITP_ROOT ?? path.resolve(scriptDir, "..", "..");

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const root = path.resolve(argValue("--root") ?? defaultRoot);
const outputDir = path.resolve(argValue("--out-dir") ?? process.env.RAW_DATA_OUT_DIR ?? path.join(root, "outputs", "raw_data_cleaning"));
const input = await FileBlob.load(path.join(outputDir, "cleaned_raw_data_combined.xlsx"));
const workbook = await SpreadsheetFile.importXlsx(input);
const sheetSummary = await workbook.inspect({
  kind: "sheet,table",
  maxChars: 4000,
  tableMaxRows: 3,
  tableMaxCols: 6,
});
console.log(sheetSummary.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula error scan",
});
console.log(errors.ndjson);

const previewDir = path.join(outputDir, "previews");
await fs.mkdir(previewDir, { recursive: true });
for (const sheetName of [
  "Rooms",
  "Staff",
  "Modules",
  "Programmes",
  "Common Modules",
  "Common Module Map",
  "Excluded Rows",
  "Cleanup Notes",
]) {
  const previewRange =
    sheetName === "Rooms"
      ? "A1:G24"
      : sheetName === "Staff"
        ? "A1:C24"
        : sheetName === "Modules"
          ? "A1:D24"
          : sheetName === "Programmes"
            ? "A1:C40"
            : undefined;
  const preview = await workbook.render({
    sheetName,
    ...(previewRange ? { range: previewRange } : { autoCrop: "all" }),
    scale: 0.7,
    format: "png",
  });
  await fs.writeFile(
    path.join(previewDir, `${sheetName.replaceAll(" ", "_").toLowerCase()}.png`),
    new Uint8Array(await preview.arrayBuffer()),
  );
}
