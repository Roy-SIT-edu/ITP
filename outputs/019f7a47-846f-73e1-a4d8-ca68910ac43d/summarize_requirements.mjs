import fs from "node:fs/promises";

const inputPath = process.argv[2];
const data = JSON.parse(await fs.readFile(inputPath, "utf8"));
const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => text(value).toLowerCase();
const increment = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const sortedCounts = (map) => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

function findHeader(values) {
  let best = null;
  for (let r = 0; r < Math.min(values.length, 20); r += 1) {
    const row = (values[r] ?? []).map(lower);
    const hasProg = row.some((v) => /^(prog|programme|program)/.test(v));
    const hasModule = row.some((v) => v.includes("module") && v.includes("code"));
    const hasActivity = row.some((v) => v === "activity" || v.includes("class type"));
    const hasDelivery = row.some((v) => v.includes("delivery mode"));
    const hasWeeks = row.some((v) => v.includes("week"));
    const hasStaff = row.some((v) => /^staff( id)? \d+/.test(v));
    const score = [hasProg, hasModule, hasActivity, hasDelivery, hasWeeks, hasStaff].filter(Boolean).length;
    if (!best || score > best.score) best = { rowIndex: r, score, values: values[r] ?? [] };
  }
  return best && best.score >= 4 ? best : null;
}

function findColumn(headers, predicate) {
  const index = headers.map(lower).findIndex(predicate);
  return index >= 0 ? index : null;
}

function inferFileContext(file) {
  const rules = [
    [/^ASE_Year (\d)/i, "ASE"], [/^EPE_Year (\d)/i, "EPE"], [/^ESE Year (\d)/i, "ESE"],
    [/^MDME_Year (\d)/i, "MDME"], [/^MEC_Year (\d)/i, "MEC"], [/^METS_Year (\d)/i, "METS"],
    [/^NAME_Year (\d)/i, "NAME"], [/^RSE_Year ?(\d)/i, "RSE"], [/^SBE Year (\d)/i, "SBE"],
  ];
  for (const [regex, programme] of rules) {
    const match = file.match(regex);
    if (match) return { programme, year: Number(match[1]), key: `${programme} Year ${match[1]}` };
  }
  if (/^2510_DSC/i.test(file)) return { programme: "DSC", year: null, key: "DSC (multi-year)" };
  if (/^EDE /i.test(file)) return { programme: "EDE", year: null, key: "EDE (multi-year)" };
  if (/CVE/i.test(file)) return { programme: "CVE", year: null, key: "CVE (multi-year)" };
  if (/^SDE /i.test(file)) return { programme: "SDE", year: null, key: "SDE (combined cohorts)" };
  if (/EEE ISE PET/i.test(file)) return { programme: "EEE/ISE/PET", year: null, key: "EEE/ISE/PET (combined)" };
  if (/Template_Lab/i.test(file)) return { programme: "LAB_REFERENCE", year: null, key: "Fixed laboratory reference" };
  if (/Template_ENG/i.test(file)) return { programme: "ENG_REFERENCE", year: null, key: "ENG generic reference" };
  return { programme: null, year: null, key: file.replace(/\.xlsx$/i, "") };
}

const headerSchemas = new Map();
const activityCounts = new Map();
const deliveryCounts = new Map();
const weekCounts = new Map();
const programmeCounts = new Map();
const moduleCounts = new Map();
const venueCounts = new Map();
const startCounts = new Map();
const staffCounts = new Map();
const staffIdCounts = new Map();
const sessionsPerWeekCounts = new Map();
const durationCounts = new Map();
const workbookInventory = [];
const rows = [];
const fileGroups = new Map();
const programmeGroups = new Map();

for (const wb of data.workbooks) {
  const inventory = {
    file: wb.file,
    sizeBytes: wb.sizeBytes,
    sheets: wb.sheets.map((s) => ({ name: s.name, address: s.address, rows: s.rows, cols: s.cols })),
  };
  workbookInventory.push(inventory);
  const sheet = wb.sheets.find((s) => lower(s.name) === "module") ?? wb.sheets.find((s) => /module|requirement/i.test(s.name));
  if (!sheet) continue;
  const header = findHeader(sheet.values);
  if (!header) continue;
  const headers = header.values.map(text);
  const schemaKey = headers.map((v) => v || "∅").join(" | ");
  if (!headerSchemas.has(schemaKey)) headerSchemas.set(schemaKey, { count: 0, files: [], headerRow: header.rowIndex + 1, headers });
  const schema = headerSchemas.get(schemaKey);
  schema.count += 1;
  schema.files.push(wb.file);

  const columns = {
    programme: findColumn(headers, (v) => /^(prog|programme|program)/.test(v)),
    classSize: findColumn(headers, (v) => v.includes("class size")),
    module: findColumn(headers, (v) => v.includes("module") && v.includes("code")),
    activity: findColumn(headers, (v) => v === "activity" || v.includes("class type")),
    delivery: findColumn(headers, (v) => v.includes("delivery mode")),
    weeks: findColumn(headers, (v) => v.includes("week")),
    venue: findColumn(headers, (v) => v === "venue" || v.includes("venue")),
    campus: findColumn(headers, (v) => v.includes("campus")),
    start7: findColumn(headers, (v) => v.includes("start at 7")),
    sessionsPerWeek: findColumn(headers, (v) => v.includes("session") && (v.includes("week") || v.includes("wk"))),
    duration: findColumn(headers, (v) => v.includes("duration")),
  };
  const remarkColumns = headers.map(lower).map((v, i) => (v.includes("remark") || v.includes("justification")) ? i : null).filter((v) => v !== null);
  const staffNameColumns = headers.map(lower).map((v, i) => (/^staff \d+$/.test(v) ? i : null)).filter((v) => v !== null);
  const staffIdColumns = headers.map(lower).map((v, i) => (/^staff id \d+$/.test(v) ? i : null)).filter((v) => v !== null);

  let lastProgramme = "";
  let lastClassSize = "";
  let lastModule = "";
  const context = inferFileContext(wb.file);
  if (!fileGroups.has(context.key)) fileGroups.set(context.key, { context, file: wb.file, modules: new Set(), activities: new Set(), programmes: new Set(), rows: 0 });
  const fileGroup = fileGroups.get(context.key);

  for (let r = header.rowIndex + 1; r < sheet.values.length; r += 1) {
    const source = sheet.values[r] ?? [];
    const rawProgramme = columns.programme === null ? "" : text(source[columns.programme]);
    const rawClassSize = columns.classSize === null ? "" : text(source[columns.classSize]);
    const rawModule = columns.module === null ? "" : text(source[columns.module]);
    const activity = columns.activity === null ? "" : text(source[columns.activity]);
    const delivery = columns.delivery === null ? "" : text(source[columns.delivery]);
    const weeks = columns.weeks === null ? "" : text(source[columns.weeks]);
    const venue = columns.venue === null ? "" : text(source[columns.venue]);
    const campus = columns.campus === null ? "" : text(source[columns.campus]);
    const start7 = columns.start7 === null ? "" : text(source[columns.start7]);
    const sessionsPerWeek = columns.sessionsPerWeek === null ? "" : text(source[columns.sessionsPerWeek]);
    const duration = columns.duration === null ? "" : text(source[columns.duration]);
    const remarks = remarkColumns.map((i) => text(source[i])).filter(Boolean).join(" | ");
    const staff = staffNameColumns.map((i) => text(source[i])).filter(Boolean);
    const staffIds = staffIdColumns.map((i) => text(source[i])).filter(Boolean);
    if (rawProgramme) lastProgramme = rawProgramme;
    if (rawClassSize) lastClassSize = rawClassSize;
    if (rawModule) lastModule = rawModule;
    const meaningful = Boolean(rawModule || activity || delivery || weeks || venue || campus || sessionsPerWeek || duration || remarks || staff.length || staffIds.length);
    if (!meaningful) continue;
    const record = {
      file: wb.file, sheet: sheet.name, sourceRow: r + 1, context,
      programme: rawProgramme || lastProgramme, rawProgramme,
      classSize: rawClassSize || lastClassSize, rawClassSize,
      module: rawModule || lastModule, rawModule,
      activity, delivery, weeks, venue, campus, start7, sessionsPerWeek, duration, remarks, staff, staffIds,
    };
    rows.push(record);
    fileGroup.rows += 1;
    if (record.module) fileGroup.modules.add(record.module);
    if (activity) fileGroup.activities.add(activity);
    if (record.programme) fileGroup.programmes.add(record.programme);
    if (record.programme) increment(programmeCounts, record.programme);
    if (record.module) increment(moduleCounts, record.module);
    if (activity) increment(activityCounts, activity);
    if (delivery) increment(deliveryCounts, delivery);
    if (weeks) increment(weekCounts, weeks);
    if (venue) increment(venueCounts, venue);
    if (start7) increment(startCounts, start7);
    if (sessionsPerWeek) increment(sessionsPerWeekCounts, sessionsPerWeek);
    if (duration) increment(durationCounts, duration);
    for (const name of staff) increment(staffCounts, name);
    for (const id of staffIds) increment(staffIdCounts, id);

    const programmeGroupKey = record.programme || context.key;
    if (!programmeGroups.has(programmeGroupKey)) programmeGroups.set(programmeGroupKey, { programme: programmeGroupKey, files: new Set(), modules: new Set(), activeModules: new Set(), activities: new Set(), rowCount: 0, classSizes: new Set() });
    const programmeGroup = programmeGroups.get(programmeGroupKey);
    programmeGroup.files.add(wb.file);
    programmeGroup.rowCount += 1;
    if (record.module) programmeGroup.modules.add(record.module);
    if (record.module && activity) programmeGroup.activeModules.add(record.module);
    if (activity) programmeGroup.activities.add(activity);
    if (record.classSize) programmeGroup.classSizes.add(record.classSize);
  }
}

const groupMatches = [];
const durationMatches = [];
const fixedMatches = [];
for (const row of rows) {
  const haystack = `${row.remarks} ${row.weeks}`.trim();
  if (/\bgroup(s)?\b|\b[ST]\d+\b|partition/i.test(haystack)) groupMatches.push(row);
  if (/\b\d+(?:\.\d+)?\s*(?:hr|hrs|hour|hours)\b|\b\d+\s*x\s*\d+(?:\.\d+)?[- ]?hour/i.test(haystack)) durationMatches.push(row);
  if (/\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\b|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\bfixed\b|\bdate\b/i.test(haystack)) fixedMatches.push(row);
}

const compactRows = (matches, limit = 40) => matches.slice(0, limit).map((row) => ({
  file: row.file, sourceRow: row.sourceRow, programme: row.programme, module: row.module,
  activity: row.activity, weeks: row.weeks, remarks: row.remarks, venue: row.venue,
}));

const output = {
  workbookCount: data.workbookCount,
  workbookInventory,
  headerSchemas: [...headerSchemas.values()].sort((a, b) => b.count - a.count),
  normalizedRowCount: rows.length,
  activities: sortedCounts(activityCounts),
  deliveries: sortedCounts(deliveryCounts),
  programmes: sortedCounts(programmeCounts),
  modules: sortedCounts(moduleCounts),
  venues: sortedCounts(venueCounts),
  startAt7: sortedCounts(startCounts),
  staff: sortedCounts(staffCounts),
  staffIds: sortedCounts(staffIdCounts),
  sessionsPerWeek: sortedCounts(sessionsPerWeekCounts),
  durations: sortedCounts(durationCounts),
  fileGroups: [...fileGroups.values()].map((group) => ({
    ...group.context,
    file: group.file,
    rowCount: group.rows,
    programmeValues: [...group.programmes].sort(),
    modules: [...group.modules].sort(),
    activities: [...group.activities].sort(),
  })),
  programmeGroups: [...programmeGroups.values()].map((group) => ({
    programme: group.programme,
    files: [...group.files].sort(),
    rowCount: group.rowCount,
    classSizes: [...group.classSizes].sort(),
    modules: [...group.modules].sort(),
    activeModules: [...group.activeModules].sort(),
    placeholderModules: [...group.modules].filter((module) => !group.activeModules.has(module)).sort(),
    activities: [...group.activities].sort(),
  })).sort((a, b) => b.modules.length - a.modules.length || a.programme.localeCompare(b.programme)),
  activityOnlineValues: sortedCounts(activityCounts).filter(([value]) => /online/i.test(value)),
  activityLabValues: sortedCounts(activityCounts).filter(([value]) => /lab/i.test(value)),
  deliveryOnlineValues: sortedCounts(deliveryCounts).filter(([value]) => /online/i.test(value)),
  groupExamples: compactRows(groupMatches),
  durationExamples: compactRows(durationMatches),
  fixedSchedulingExamples: compactRows(fixedMatches),
  normalizedSamples: rows.slice(0, 80),
};

await fs.writeFile(process.argv[3], JSON.stringify(output, null, 2));
console.log(JSON.stringify({
  workbookCount: output.workbookCount,
  normalizedRowCount: output.normalizedRowCount,
  headerSchemaCount: output.headerSchemas.length,
  activities: output.activities,
  deliveries: output.deliveries,
  activityOnlineValues: output.activityOnlineValues,
  activityLabValues: output.activityLabValues,
  deliveryOnlineValues: output.deliveryOnlineValues,
  fileGroups: output.fileGroups.map((g) => ({ key: g.key, rows: g.rowCount, moduleCount: g.modules.length, modules: g.modules })),
  programmeGroups: output.programmeGroups.map((g) => ({ programme: g.programme, moduleCount: g.modules.length, modules: g.modules })),
}, null, 2));
