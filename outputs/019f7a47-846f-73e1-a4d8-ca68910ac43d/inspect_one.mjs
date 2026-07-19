import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const file = process.argv[2];
const input = await FileBlob.load(file);
const wb = await SpreadsheetFile.importXlsx(input);
const summary = await wb.inspect({ kind: "workbook,sheet,table", maxChars: 12000, tableMaxRows: 12, tableMaxCols: 20, tableMaxCellChars: 120 });
console.log(summary.ndjson);
