import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const backendDataDir = path.join(repoRoot, "ITP Programming App 2", "timetable-app", "backend", "data");
const outputPath = path.join(__dirname, "robust_20_programme_input_template.xlsx");

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

const py = String.raw`
import json
import pathlib
import re
import sqlite3
import sys

base = pathlib.Path(sys.argv[1])

def rows(db_name, query, params=()):
    con = sqlite3.connect(base / f"{db_name}.db")
    try:
        con.row_factory = sqlite3.Row
        return [dict(row) for row in con.execute(query, params).fetchall()]
    finally:
        con.close()

programmes = rows("programmes", "select id, code, name, years from programmes order by code")
modules = rows("modules", "select module_code, module_title from modules order by module_code")
staff = rows("staff", "select staff_name, staff_id from staff where staff_name is not null and staff_id is not null order by staff_name")

modules_by_prefix = {}
for module in modules:
    match = re.match(r"([A-Za-z]+)", module["module_code"] or "")
    if match:
        modules_by_prefix.setdefault(match.group(1).upper(), []).append(module)

eligible = [programme for programme in programmes if len(modules_by_prefix.get(programme["code"], [])) >= 5]
if len(eligible) < 20:
    raise SystemExit(f"Need at least 20 programmes with 5 modules each; found {len(eligible)}")
selected = eligible[:20]

activity_patterns = [
    {
        "class_type": "Lecture",
        "session_count": 1,
        "duration_hours": 2,
        "sessions_per_week": 1,
        "delivery_mode": "Face-to-face",
        "venue": "Lectorial",
        "campus": "Physical",
        "class_size": 80,
    },
    {
        "class_type": "Tutorial",
        "session_count": 1,
        "duration_hours": 2,
        "sessions_per_week": 1,
        "delivery_mode": "Face-to-face",
        "venue": "Seminar Room",
        "campus": "Physical",
        "class_size": 35,
    },
    {
        "class_type": "Laboratory",
        "session_count": 1,
        "duration_hours": 2,
        "sessions_per_week": 1,
        "delivery_mode": "Face-to-face",
        "venue": "Computer Lab",
        "campus": "Physical",
        "class_size": 45,
    },
    {
        "class_type": "Workshop",
        "session_count": 1,
        "duration_hours": 1,
        "sessions_per_week": 2,
        "delivery_mode": "Hybrid",
        "venue": "Seminar Room",
        "campus": "Physical",
        "class_size": 30,
    },
    {
        "class_type": "Online",
        "session_count": 1,
        "duration_hours": 1,
        "sessions_per_week": 1,
        "delivery_mode": "Online",
        "venue": "Virtual",
        "campus": "Virtual",
        "class_size": 80,
    },
]

days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
starts = [("09:00", "11:00"), ("10:00", "12:00"), ("11:00", "13:00"), ("13:00", "15:00"), ("14:00", "16:00")]
required = []
optional = []
coverage = {
    "programmes": set(),
    "modules": set(),
    "class_types": set(),
    "delivery_modes": set(),
    "venue_types": set(),
    "common_rows": 0,
}

def module_year(module_code, programme_years):
    match = re.search(r"(\d)", module_code or "")
    raw = int(match.group(1)) if match else 1
    return max(1, min(raw, int(programme_years or 1)))

def staff_pair(index, include_second=False, include_third=False):
    first = staff[(index * 3) % len(staff)]
    second = staff[(index * 3 + 1) % len(staff)] if include_second else {"staff_name": None, "staff_id": None}
    third = staff[(index * 3 + 2) % len(staff)] if include_third else {"staff_name": None, "staff_id": None}
    return first, second, third

def add_row(requirement_id, programme, module, pattern, index, common=None):
    year = module_year(module["module_code"], programme["years"])
    partition = 2 if pattern["class_type"] in {"Tutorial", "Laboratory", "Workshop"} and index % 2 else 1
    group_code = f"{programme['code']} Y{year} P{partition}"
    include_second = pattern["class_type"] in {"Lecture", "Laboratory"} or bool(common)
    include_third = pattern["class_type"] == "Laboratory"
    s1, s2, s3 = staff_pair(index, include_second=include_second, include_third=include_third)

    required.append({
        "Requirement ID": requirement_id,
        "Programme": programme["code"],
        "Year": year,
        "Student Group Code": group_code,
        "Module Code": module["module_code"],
        "Module Title": module.get("module_title") or module["module_code"],
        "Class Type": pattern["class_type"],
        "Session Count": pattern["session_count"],
        "Duration Hours": pattern["duration_hours"],
        "Sessions Per Week": pattern["sessions_per_week"],
        "Delivery Mode": pattern["delivery_mode"],
        "Venue Type Required": pattern["venue"],
        "Campus Mode": pattern["campus"],
        "Exact Class Size": pattern["class_size"],
        "Staff 1 Name": s1["staff_name"],
        "Staff 1 ID": s1["staff_id"],
        "Staff 2 Name": s2["staff_name"],
        "Staff 2 ID": s2["staff_id"],
        "Staff 3 Name": s3["staff_name"],
        "Staff 3 ID": s3["staff_id"],
        "Staff 4 Name": None,
        "Staff 4 ID": None,
    })

    pattern_index = index % len(activity_patterns)
    if common:
        week_pattern = common.get("week_pattern", "Weekly")
        custom_weeks = common.get("custom_weeks")
        scheduling_type = "Flexible"
        fixed_day = fixed_start = fixed_end = None
        common_flag = "Yes"
        shared_id = common["shared_id"]
        combined = ", ".join(code for code in common["programmes"] if code != programme["code"])
        hard_notes = common["hard_notes"]
        soft_notes = common["soft_notes"]
        remarks = common["remarks"]
        coverage["common_rows"] += 1
    elif pattern_index == 0:
        week_pattern = "Weekly"
        custom_weeks = None
        scheduling_type = "Fixed"
        fixed_day = days[(index // len(activity_patterns)) % len(days)]
        fixed_start, fixed_end = starts[(index // len(activity_patterns)) % len(starts)]
        common_flag = "No"
        shared_id = combined = None
        hard_notes = "Use recording-capable lectorial; keep main cohort together."
        soft_notes = "Prefer morning slots where possible."
        remarks = "Large cohort anchor lecture."
    elif pattern_index == 1:
        week_pattern = "Odd" if index % 4 == 1 else "Even"
        custom_weeks = None
        scheduling_type = "Flexible"
        fixed_day = fixed_start = fixed_end = None
        common_flag = "No"
        shared_id = combined = None
        hard_notes = "Requires seminar room seating for active discussion."
        soft_notes = "Avoid Friday where possible."
        remarks = "Tutorial split; suitable for repeated group scheduling."
    elif pattern_index == 2:
        week_pattern = "Custom"
        custom_weeks = "3,6,9,12"
        scheduling_type = "Flexible"
        fixed_day = fixed_start = fixed_end = None
        common_flag = "No"
        shared_id = combined = None
        hard_notes = "Needs computer lab capacity and recording where available."
        soft_notes = "Prefer not adjacent to online sessions."
        remarks = "Custom teaching weeks for lab rotations."
    elif pattern_index == 3:
        week_pattern = "Weekly"
        custom_weeks = None
        scheduling_type = "Flexible"
        fixed_day = fixed_start = fixed_end = None
        common_flag = "No"
        shared_id = combined = None
        hard_notes = "Hybrid workshop should use physical room this term."
        soft_notes = "Prefer Tuesday or Thursday afternoon."
        remarks = "Two workshop meetings per week request."
    else:
        week_pattern = "Weekly"
        custom_weeks = None
        scheduling_type = "Flexible"
        fixed_day = fixed_start = fixed_end = None
        common_flag = "No"
        shared_id = combined = None
        hard_notes = "Virtual/online delivery only."
        soft_notes = "Prefer Monday or Tuesday for online sessions."
        remarks = "Online asynchronous/synchronous component."

    optional.append({
        "Requirement ID": requirement_id,
        "Start Week": 1,
        "End Week": 13,
        "Week Pattern": week_pattern,
        "Custom Weeks": custom_weeks,
        "Scheduling Type": scheduling_type,
        "Preferred Days": "Monday,Tuesday" if pattern["delivery_mode"] == "Online" else "Tuesday,Thursday",
        "Avoid Days": "Friday" if pattern["class_type"] in {"Tutorial", "Laboratory"} else None,
        "Fixed Day": fixed_day,
        "Fixed Start Time": fixed_start,
        "Fixed End Time": fixed_end,
        "Priority": "High" if common else "Normal",
        "Common Module?": common_flag,
        "Shared Session Group ID": shared_id,
        "Combined With Programmes": combined,
        "Hard Constraint Notes": hard_notes,
        "Soft Preference Notes": soft_notes,
        "Remarks": remarks,
    })

    coverage["programmes"].add(programme["code"])
    coverage["modules"].add(module["module_code"])
    coverage["class_types"].add(pattern["class_type"])
    coverage["delivery_modes"].add(pattern["delivery_mode"])
    coverage["venue_types"].add(pattern["venue"])

row_index = 0
for programme in selected:
    for module_index, module in enumerate(modules_by_prefix[programme["code"]][:5]):
        add_row(
            f"ROB-{programme['code']}-{module_index + 1:02d}",
            programme,
            module,
            activity_patterns[module_index],
            row_index,
        )
        row_index += 1

programme_by_code = {programme["code"]: programme for programme in programmes}
module_by_code = {module["module_code"]: module for module in modules}
common_clusters = [
    {
        "module": "ENG1002",
        "programmes": ["SBE", "ESE", "MEC", "CVE"],
        "shared_id": "COMMON-ENG1002-ENG-BUILT",
        "class_type": "Lecture",
        "delivery_mode": "Face-to-face",
        "venue": "Lectorial",
        "campus": "Physical",
        "class_size": 120,
        "week_pattern": "Weekly",
        "hard_notes": "Common engineering lecture; use recording-capable lectorial.",
        "soft_notes": "Keep all shared cohorts on the same day.",
        "remarks": "Common module shared across engineering cohorts.",
    },
    {
        "module": "UCS1001",
        "programmes": ["AAI", "ICT", "DSC", "CEG"],
        "shared_id": "COMMON-UCS1001-DIGITAL",
        "class_type": "Online",
        "delivery_mode": "Online",
        "venue": "Virtual",
        "campus": "Virtual",
        "class_size": 100,
        "week_pattern": "Weekly",
        "hard_notes": "Virtual common module; no physical room required.",
        "soft_notes": "Prefer early week online release.",
        "remarks": "University common module delivered online.",
    },
    {
        "module": "ENG1007",
        "programmes": ["EDE", "EEE", "EPE", "RSE"],
        "shared_id": "COMMON-ENG1007-ELECTRICAL",
        "class_type": "Laboratory",
        "delivery_mode": "Face-to-face",
        "venue": "Computer Lab",
        "campus": "Physical",
        "class_size": 45,
        "week_pattern": "Custom",
        "custom_weeks": "2,5,8,11",
        "hard_notes": "Shared lab rotation; requires computer room.",
        "soft_notes": "Avoid back-to-back with lectorials.",
        "remarks": "Common module lab rotation across electrical programmes.",
    },
    {
        "module": "CSC1108",
        "programmes": ["AAI", "BAC", "ICT", "CEG"],
        "shared_id": "COMMON-CSC1108-COMPUTING",
        "class_type": "Tutorial",
        "delivery_mode": "Hybrid",
        "venue": "Seminar Room",
        "campus": "Physical",
        "class_size": 35,
        "week_pattern": "Even",
        "hard_notes": "Shared computing tutorial; seminar room required.",
        "soft_notes": "Prefer same half of week as online component.",
        "remarks": "Common computing tutorial cluster.",
    },
]

for cluster_index, cluster in enumerate(common_clusters, start=1):
    module = module_by_code[cluster["module"]]
    pattern = {
        "class_type": cluster["class_type"],
        "session_count": 1,
        "duration_hours": 2 if cluster["class_type"] != "Online" else 1,
        "sessions_per_week": 1,
        "delivery_mode": cluster["delivery_mode"],
        "venue": cluster["venue"],
        "campus": cluster["campus"],
        "class_size": cluster["class_size"],
    }
    for programme_code in cluster["programmes"]:
        programme = programme_by_code[programme_code]
        add_row(
            f"COM-{cluster_index:02d}-{programme_code}",
            programme,
            module,
            pattern,
            row_index,
            common=cluster,
        )
        row_index += 1

summary = {
    "required_rows": len(required),
    "optional_rows": len(optional),
    "programmes": sorted(coverage["programmes"]),
    "programme_count": len(coverage["programmes"]),
    "module_count": len(coverage["modules"]),
    "class_types": sorted(coverage["class_types"]),
    "delivery_modes": sorted(coverage["delivery_modes"]),
    "venue_types": sorted(coverage["venue_types"]),
    "common_rows": coverage["common_rows"],
}
print(json.dumps({"required": required, "optional": optional, "summary": summary}))
`;

function runPythonDataBuilder() {
  const result = spawnSync("python", ["-c", py, backendDataDir], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Data builder failed:\n${result.stderr}\n${result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function asMatrix(rows, columns) {
  return [columns, ...rows.map((row) => columns.map((column) => row[column] ?? null))];
}

function columnName(index) {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function setColumnWidths(sheet, widths, rowCount) {
  widths.forEach((width, index) => {
    sheet.getRangeByIndexes(0, index, rowCount, 1).format.columnWidth = width;
  });
}

function writeSheet(sheet, matrix, options = {}) {
  const rowCount = matrix.length;
  const colCount = matrix[0].length;
  sheet.getRangeByIndexes(0, 0, rowCount, colCount).values = matrix;
  sheet.getRangeByIndexes(0, 0, 1, colCount).format = {
    fill: options.headerFill ?? "#1F4E78",
    font: { bold: true, color: "#FFFFFF" },
  };
  sheet.getRangeByIndexes(0, 0, rowCount, colCount).format.borders = {
    preset: "all",
    style: "thin",
    color: "#D9E2F3",
  };
  sheet.freezePanes.freezeRows(1);
  sheet.showGridLines = false;
  if (options.wrapCols) {
    for (const index of options.wrapCols) {
      sheet.getRangeByIndexes(0, index, rowCount, 1).format.wrapText = true;
    }
  }
  if (options.widths) {
    setColumnWidths(sheet, options.widths, rowCount);
  } else {
    sheet.getRangeByIndexes(0, 0, rowCount, colCount).format.autofitColumns();
  }
}

function writeReadme(sheet, summary) {
  const rows = [
    ["Sample", "Robust timetable input template"],
    ["Input rows", summary.required_rows],
    ["Programmes covered", summary.programme_count],
    ["Programmes", summary.programmes.join(", ")],
    ["Distinct modules", summary.module_count],
    ["Common-module rows", summary.common_rows],
    ["Class types", summary.class_types.join(", ")],
    ["Delivery modes", summary.delivery_modes.join(", ")],
    ["Venue/location requirements", summary.venue_types.join(", ")],
    ["How to use", "Upload this workbook through the existing Input Template upload flow."],
    ["Tabs", "Input_Template contains required row data. Remarks_(optional) contains constraints and common-module metadata joined by Requirement ID."],
  ];
  writeSheet(sheet, rows, {
    headerFill: "#548235",
    widths: [26, 120],
    wrapCols: [1],
  });
}

const data = runPythonDataBuilder();
const workbook = Workbook.create();
const inputSheet = workbook.worksheets.add("Input_Template");
const optionalSheet = workbook.worksheets.add("Remarks_(optional)");
const readmeSheet = workbook.worksheets.add("README");

const inputMatrix = asMatrix(data.required, inputColumns);
const optionalMatrix = asMatrix(data.optional, optionalColumns);

writeSheet(inputSheet, inputMatrix, {
  headerFill: "#1F4E78",
  widths: [20, 12, 8, 20, 16, 18, 15, 14, 14, 18, 18, 22, 14, 16, 32, 14, 32, 14, 32, 14, 24, 12],
  wrapCols: [5, 14, 16, 18],
});
writeSheet(optionalSheet, optionalMatrix, {
  headerFill: "#7030A0",
  widths: [20, 12, 12, 16, 18, 18, 22, 16, 14, 16, 16, 12, 18, 28, 30, 48, 48, 56],
  wrapCols: [14, 15, 16, 17],
});
writeReadme(readmeSheet, data.summary);

const errorScan = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 50 },
  summary: "formula error scan",
});
console.log(errorScan.ndjson);

const inputPreview = await workbook.render({ sheetName: "Input_Template", range: "A1:V24", scale: 1, format: "png" });
await fs.writeFile(path.join(__dirname, "preview_input_template.png"), new Uint8Array(await inputPreview.arrayBuffer()));
const optionalPreview = await workbook.render({ sheetName: "Remarks_(optional)", range: "A1:R24", scale: 1, format: "png" });
await fs.writeFile(path.join(__dirname, "preview_optional.png"), new Uint8Array(await optionalPreview.arrayBuffer()));
const readmePreview = await workbook.render({ sheetName: "README", range: "A1:B12", scale: 1, format: "png" });
await fs.writeFile(path.join(__dirname, "preview_readme.png"), new Uint8Array(await readmePreview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

await fs.writeFile(path.join(__dirname, "robust_20_programme_input_template.summary.json"), JSON.stringify(data.summary, null, 2));
console.log(JSON.stringify({ outputPath, summary: data.summary }, null, 2));
