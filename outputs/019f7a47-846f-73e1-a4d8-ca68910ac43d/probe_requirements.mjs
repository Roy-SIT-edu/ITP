import fs from "node:fs/promises";

const data = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

for (const wb of data.workbooks) {
  console.log(`\n## ${wb.file}`);
  console.log(wb.sheets.map((s) => `${s.name}[${s.address ?? "-"};${s.rows}x${s.cols}]`).join(" | "));
  for (const sheet of wb.sheets) {
    const populated = sheet.values
      .map((row, index) => ({ row: index + 1, values: row.map(clean) }))
      .filter((entry) => entry.values.some(Boolean));
    const header = sheet.headerCandidates[0];
    const interesting = populated.filter((entry) => entry.row <= Math.max(15, (header?.row ?? 1) + 4)).slice(0, 12);
    console.log(`  - ${sheet.name} headers=${sheet.headerCandidates.map((h) => h.row).join(",") || "none"}`);
    for (const entry of interesting) console.log(`    R${entry.row}: ${entry.values.map((v, i) => v ? `${i + 1}=${v}` : null).filter(Boolean).join(" | ")}`);
  }
}
