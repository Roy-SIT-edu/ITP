import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const __filename = fileURLToPath(import.meta.url);
const outputDir = path.dirname(__filename);
const repoRoot = path.resolve(outputDir, "..", "..");
const backendRoot = path.join(repoRoot, "ITP Programming App 2", "timetable-app", "backend");
const backendDataDir = path.join(backendRoot, "data");
const labSeedPath = path.join(backendRoot, "app", "data", "lab_requirements_seed.json");
const outputPath = path.join(outputDir, "validated_no_conflicts_20_programme_input_template.xlsx");
const bundledPython = process.env.CODEX_BUNDLED_PYTHON;
const backendPython = process.env.BACKEND_PYTHON;

if (!bundledPython || !backendPython) {
  throw new Error("CODEX_BUNDLED_PYTHON and BACKEND_PYTHON must point to the bundled and project Python runtimes.");
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

const dataBuilderPython = String.raw`
import json
import pathlib
import re
import sqlite3
import sys

data_dir = pathlib.Path(sys.argv[1])
lab_seed_path = pathlib.Path(sys.argv[2])

def rows(db_name, query):
    connection = sqlite3.connect(data_dir / f"{db_name}.db")
    try:
        connection.row_factory = sqlite3.Row
        return [dict(row) for row in connection.execute(query).fetchall()]
    finally:
        connection.close()

programmes = rows("programmes", "select id, code, name, years from programmes order by code")
modules = rows("modules", "select module_code, module_title from modules order by module_code")
staff = rows(
    "staff",
    "select staff_name, staff_id from staff where staff_name is not null and staff_id is not null order by staff_id, staff_name",
)

lab_seed = json.loads(lab_seed_path.read_text(encoding="ascii"))
lab_staff_names = {
    part.strip().casefold()
    for requirement in lab_seed.get("lab_requirements", [])
    for part in re.split(r"[;,]+", requirement.get("staff_names") or "")
    if part.strip()
}

eligible_programmes = []
modules_by_programme = {}
for programme in programmes:
    code = programme["code"]
    clean_modules = [
        module
        for module in modules
        if re.fullmatch(rf"{re.escape(code)}\d{{4}}[A-Z]?", module.get("module_code") or "", flags=re.IGNORECASE)
    ]
    if len(clean_modules) >= 5:
        eligible_programmes.append(programme)
        modules_by_programme[code] = clean_modules[:5]

if len(eligible_programmes) < 20:
    raise SystemExit(f"Need 20 programmes with five clean module codes; found {len(eligible_programmes)}")

selected_programmes = eligible_programmes[:20]
selected_staff = [item for item in staff if item["staff_name"].casefold() not in lab_staff_names][:100]
if len(selected_staff) < 100:
    raise SystemExit(f"Need 100 non-lab staff records; found {len(selected_staff)}")

def module_year(programme, module_code):
    suffix = module_code[len(programme["code"]):]
    match = re.search(r"(\d)", suffix)
    raw_year = int(match.group(1)) if match else 1
    return max(1, min(raw_year, int(programme.get("years") or 1)))

required_rows = []
optional_rows = []
staff_index = 0
for programme in selected_programmes:
    for module_index, module in enumerate(modules_by_programme[programme["code"]], start=1):
        staff_member = selected_staff[staff_index]
        staff_index += 1
        year = module_year(programme, module["module_code"])
        class_type = "Lecture" if module_index in {1, 3, 5} else "Tutorial"
        venue = "Lectorial" if class_type == "Lecture" else "Seminar Room"
        class_size = 60 if class_type == "Lecture" else 30
        requirement_id = f"NCF-{programme['code']}-{module_index:02d}"
        group_code = f"{programme['code']} Y{year} P{50 + module_index}"

        required_rows.append({
            "Requirement ID": requirement_id,
            "Programme": programme["code"],
            "Year": year,
            "Student Group Code": group_code,
            "Module Code": module["module_code"],
            "Module Title": module.get("module_title") or module["module_code"],
            "Class Type": class_type,
            "Session Count": 1,
            "Duration Hours": 3,
            "Sessions Per Week": 1,
            "Delivery Mode": "Face-to-face",
            "Venue Type Required": venue,
            "Campus Mode": "Physical",
            "Exact Class Size": class_size,
            "Staff 1 Name": staff_member["staff_name"],
            "Staff 1 ID": staff_member["staff_id"],
            "Staff 2 Name": None,
            "Staff 2 ID": None,
            "Staff 3 Name": None,
            "Staff 3 ID": None,
            "Staff 4 Name": None,
            "Staff 4 ID": None,
        })

        optional_rows.append({
            "Requirement ID": requirement_id,
            "Start Week": 1,
            "End Week": 13,
            "Week Pattern": "Weekly",
            "Custom Weeks": None,
            "Scheduling Type": "Flexible",
            "Preferred Days": None,
            "Avoid Days": None,
            "Fixed Day": None,
            "Fixed Start Time": None,
            "Fixed End Time": None,
            "Priority": "Normal",
            "Common Module?": "No",
            "Shared Session Group ID": None,
            "Combined With Programmes": None,
            "Hard Constraint Notes": None,
            "Soft Preference Notes": None,
            "Remarks": "Face-to-face requirement; labs are supplied separately by the application.",
        })

summary = {
    "input_row_count": len(required_rows),
    "programme_count": len(selected_programmes),
    "programmes": [item["code"] for item in selected_programmes],
    "modules_per_programme": {
        item["code"]: len(modules_by_programme[item["code"]]) for item in selected_programmes
    },
    "class_types": sorted({row["Class Type"] for row in required_rows}),
    "delivery_modes": sorted({row["Delivery Mode"] for row in required_rows}),
    "venue_types": sorted({row["Venue Type Required"] for row in required_rows}),
    "fixed_uploaded_rows": sum(row["Scheduling Type"] == "Fixed" for row in optional_rows),
    "online_class_type_rows": sum(row["Class Type"].casefold().startswith("online") for row in required_rows),
    "lab_class_type_rows": sum("lab" in row["Class Type"].casefold() for row in required_rows),
    "lab_venue_rows": sum("lab" in row["Venue Type Required"].casefold() for row in required_rows),
}

print(json.dumps({"required": required_rows, "optional": optional_rows, "summary": summary}, ensure_ascii=False))
`;

const verifierPython = String.raw`
import json
import pathlib
import sqlite3
import sys
import tempfile

backend_root = pathlib.Path(sys.argv[1])
workbook_path = pathlib.Path(sys.argv[2])
sys.path.insert(0, str(backend_root))

from app import models  # noqa: F401
from app.database import Base
from app.models.session import Session
from app.models.staff import Staff
from app.services.import_service import ImportService
from app.services.schedule_service import ScheduleService
from app.services.seed_service import seed_defaults
from app.services.validation_service import ValidationService
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

with tempfile.TemporaryDirectory(prefix="validated-template-qa-") as temp_dir:
    database_path = pathlib.Path(temp_dir) / "qa.db"
    engine = create_engine(
        f"sqlite:///{database_path}",
        connect_args={"check_same_thread": False},
    )
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSession()
    try:
        seed_defaults(
            db,
            raw_data_path=backend_root / "data" / "Raw Data.xlsx",
            seed_lab_requirements=True,
        )
        db.query(Staff).delete(synchronize_session=False)
        current_staff = sqlite3.connect(backend_root / "data" / "staff.db")
        try:
            for staff_id, staff_name, staff_code in current_staff.execute(
                "select id, staff_name, staff_id from staff order by id"
            ).fetchall():
                db.add(Staff(id=staff_id, staff_name=staff_name, staff_id=staff_code))
        finally:
            current_staff.close()
        db.commit()
        imported = ImportService().import_input_template(db, workbook_path)
        pre_validation = ValidationService().validate_latest(db)

        uploaded_sessions = db.query(Session).filter(Session.is_lab_requirement.is_(False)).all()
        programme_modules = {}
        class_types = set()
        delivery_modes = set()
        for session in uploaded_sessions:
            programme_modules.setdefault(session.programme.code, set()).add(session.module.module_code)
            class_types.add(session.class_type)
            delivery_modes.add(session.delivery_mode)

        if imported["rows_imported"] != 100 or imported["rows_failed"] != 0:
            raise SystemExit(f"Import verification failed: {imported}")
        if pre_validation["error_count"] != 0:
            raise SystemExit(f"Saved-data validation failed: {pre_validation['errors'][:10]}")
        if pre_validation["warning_count"] != 0:
            raise SystemExit(f"Saved-data validation warnings remain: {pre_validation['warnings'][:10]}")
        if len(programme_modules) != 20 or min(map(len, programme_modules.values())) < 5:
            raise SystemExit(f"Programme/module coverage failed: {programme_modules}")
        if any(value.casefold().startswith("online") or "lab" in value.casefold() for value in class_types):
            raise SystemExit(f"Invalid class types found: {sorted(class_types)}")

        generation = ScheduleService().generate(
            db,
            academic_year="2025/26",
            trimester=3,
            timeout=180.0,
            reproducible=True,
        )
        post_validation = ValidationService().validate_latest(db)
        if generation["solver_status"] not in {"OPTIMAL", "FEASIBLE"}:
            raise SystemExit(f"Schedule generation failed: {generation}")
        if generation["hard_violation_count"] != 0:
            raise SystemExit(f"Generated schedule has hard conflicts: {generation}")
        if post_validation["schedule_issues"]["hard_count"] != 0:
            raise SystemExit(f"Post-generation hard conflict validation failed: {post_validation['schedule_issues']}")

        result = {
            "import": {
                "rows_read": imported["rows_read"],
                "rows_imported": imported["rows_imported"],
                "rows_failed": imported["rows_failed"],
            },
            "saved_data_validation": {
                "is_valid": pre_validation["is_valid"],
                "error_count": pre_validation["error_count"],
                "warning_count": pre_validation["warning_count"],
            },
            "coverage": {
                "programme_count": len(programme_modules),
                "minimum_distinct_modules_per_programme": min(map(len, programme_modules.values())),
                "class_types": sorted(class_types),
                "delivery_modes": sorted(delivery_modes),
            },
            "schedule_generation": {
                "solver_status": generation["solver_status"],
                "hard_violation_count": generation["hard_violation_count"],
                "soft_warning_count": generation["soft_warning_count"],
                "excluded_lab_session_count": generation.get("excluded_lab_session_count", 0),
                "schedule_validation_hard_count": post_validation["schedule_issues"]["hard_count"],
            },
        }
        print(json.dumps(result))
    finally:
        db.close()
        engine.dispose()
`;

function runPython(script, args, options = {}) {
  const { executable = bundledPython, ...spawnOptions } = options;
  const result = spawnSync(executable, ["-c", script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...spawnOptions,
  });
  if (result.status !== 0) {
    throw new Error(`Bundled Python task failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function matrixFromRows(rows, columns) {
  return [columns, ...rows.map((row) => columns.map((column) => row[column] ?? null))];
}

function setWidths(sheet, widths, rowCount) {
  widths.forEach((width, index) => {
    sheet.getRangeByIndexes(0, index, rowCount, 1).format.columnWidth = width;
  });
}

function styleDataSheet(sheet, matrix, options) {
  const rowCount = matrix.length;
  const columnCount = matrix[0].length;
  const usedRange = sheet.getRangeByIndexes(0, 0, rowCount, columnCount);
  usedRange.values = matrix;
  usedRange.format.borders = {
    insideHorizontal: { style: "thin", color: "#D9E2F3" },
    bottom: { style: "thin", color: "#AAB7C4" },
  };
  usedRange.format.rowHeight = 20;
  const header = sheet.getRangeByIndexes(0, 0, 1, columnCount);
  header.format = {
    fill: options.headerFill,
    font: { bold: true, color: "#FFFFFF" },
    wrapText: true,
  };
  header.format.rowHeight = 34;
  setWidths(sheet, options.widths, rowCount);
  for (const columnIndex of options.wrapColumns ?? []) {
    sheet.getRangeByIndexes(1, columnIndex, rowCount - 1, 1).format.wrapText = true;
  }
  sheet.freezePanes.freezeRows(1);
  if (options.freezeColumns) {
    sheet.freezePanes.freezeColumns(options.freezeColumns);
  }
  sheet.showGridLines = false;
}

const data = JSON.parse(runPython(dataBuilderPython, [backendDataDir, labSeedPath]));
await fs.mkdir(outputDir, { recursive: true });

const workbook = Workbook.create();
const inputSheet = workbook.worksheets.add("Input_Template");
const optionalSheet = workbook.worksheets.add("Remarks_(optional)");
const readmeSheet = workbook.worksheets.add("README");
const qualitySheet = workbook.worksheets.add("Quality_Check");

const inputMatrix = matrixFromRows(data.required, inputColumns);
const optionalMatrix = matrixFromRows(data.optional, optionalColumns);

styleDataSheet(inputSheet, inputMatrix, {
  headerFill: "#1F4E78",
  freezeColumns: 4,
  widths: [20, 12, 8, 20, 16, 24, 14, 13, 14, 18, 17, 21, 14, 16, 30, 14, 24, 14, 24, 14, 24, 14],
  wrapColumns: [5, 14, 16, 18, 20],
});

styleDataSheet(optionalSheet, optionalMatrix, {
  headerFill: "#7030A0",
  freezeColumns: 1,
  widths: [20, 12, 12, 15, 18, 18, 20, 16, 14, 17, 16, 12, 18, 28, 30, 38, 38, 60],
  wrapColumns: [14, 15, 16, 17],
});

inputSheet.getRange("C2:C101").format.numberFormat = "0";
inputSheet.getRange("H2:J101").format.numberFormat = "0";
inputSheet.getRange("N2:N101").format.numberFormat = "0";
inputSheet.getRange("G2:G101").dataValidation = {
  rule: { type: "list", values: ["Lecture", "Tutorial", "Seminar", "Workshop"] },
};
inputSheet.getRange("H2:H101").dataValidation = {
  rule: { type: "whole", operator: "between", formula1: 1, formula2: 5 },
};
inputSheet.getRange("I2:I101").dataValidation = {
  rule: { type: "decimal", operator: "between", formula1: 1, formula2: 5 },
};
inputSheet.getRange("J2:J101").dataValidation = {
  rule: { type: "whole", operator: "between", formula1: 1, formula2: 5 },
};
inputSheet.getRange("K2:K101").dataValidation = {
  rule: { type: "list", values: ["Face-to-face", "Online", "Hybrid", "Asynchronous"] },
};
inputSheet.getRange("L2:L101").dataValidation = {
  rule: { type: "list", values: ["Lectorial", "Seminar Room", "Classroom"] },
};
inputSheet.getRange("M2:M101").dataValidation = {
  rule: { type: "list", values: ["Physical", "Virtual"] },
};
optionalSheet.getRange("D2:D101").dataValidation = {
  rule: { type: "list", values: ["Weekly", "Odd", "Even", "Custom"] },
};
optionalSheet.getRange("F2:F101").dataValidation = {
  rule: { type: "list", values: ["Flexible", "Fixed"] },
};
optionalSheet.getRange("L2:L101").dataValidation = {
  rule: { type: "list", values: ["Low", "Normal", "High", "Hard"] },
};

readmeSheet.showGridLines = false;
readmeSheet.getRange("A1:F1").merge();
readmeSheet.getRange("A1").values = [["Validated 20-Programme Timetable Input Template"]];
readmeSheet.getRange("A1:F1").format = {
  fill: "#2F6B3C",
  font: { bold: true, color: "#FFFFFF", size: 16 },
};
readmeSheet.getRange("A1:F1").format.rowHeight = 32;
readmeSheet.getRange("A3:B12").values = [
  ["Workbook status", null],
  ["Input requirements", null],
  ["Programmes", null],
  ["Minimum modules per programme", null],
  ["Uploaded class types", null],
  ["Uploaded delivery mode", null],
  ["Uploaded fixed rows", null],
  ["Uploaded lab rows", null],
  ["Scheduling design", "All uploaded requirements are flexible; the application supplies fixed labs separately."],
  ["How to use", "Upload this workbook through the Input Template upload flow. Input_Template contains required data; Remarks_(optional) supplies week and scheduling metadata by Requirement ID."],
];
readmeSheet.getRange("B3:B10").formulas = [
  ["='Quality_Check'!B2"],
  ["='Quality_Check'!B5"],
  ["='Quality_Check'!B4"],
  ["=MIN('Quality_Check'!B15:B34)"],
  ["=\"Lecture, Tutorial\""],
  ["=\"Face-to-face\""],
  ["='Quality_Check'!B9"],
  ["='Quality_Check'!B6+'Quality_Check'!B7"],
];
readmeSheet.getRange("A3:A12").format = {
  fill: "#E2F0D9",
  font: { bold: true, color: "#274E13" },
};
readmeSheet.getRange("A3:B12").format.borders = {
  insideHorizontal: { style: "thin", color: "#C6D9B3" },
  bottom: { style: "thin", color: "#A8BF94" },
};
readmeSheet.getRange("B11:B12").format.wrapText = true;
readmeSheet.getRange("A1:A12").format.columnWidth = 34;
readmeSheet.getRange("B1:B12").format.columnWidth = 110;
readmeSheet.getRange("A3:B12").format.rowHeight = 24;
readmeSheet.getRange("A11:B12").format.rowHeight = 44;
readmeSheet.freezePanes.freezeRows(1);

qualitySheet.showGridLines = false;
qualitySheet.getRange("A1:D1").merge();
qualitySheet.getRange("A1").values = [["Workbook Quality Checks"]];
qualitySheet.getRange("A1:D1").format = {
  fill: "#0F6B78",
  font: { bold: true, color: "#FFFFFF", size: 15 },
};
qualitySheet.getRange("A1:D1").format.rowHeight = 30;
qualitySheet.getRange("A2:B10").values = [
  ["Overall status", null],
  [null, null],
  ["Programmes meeting 5-module minimum", null],
  ["Input requirement rows", null],
  ["Invalid Online/Lab class types", null],
  ["Uploaded lab venue rows", null],
  ["Online delivery rows", null],
  ["Uploaded fixed scheduling rows", null],
  ["Blank required-field cells", null],
];
qualitySheet.getRange("B2:B10").formulas = [
  ["=IF(AND(B4=20,B5=100,B6=0,B7=0,B8=0,B9=0,B10=0),\"PASS\",\"REVIEW\")"],
  [null],
  ["=COUNTIF(C15:C34,\"PASS\")"],
  ["=COUNTA('Input_Template'!A2:A101)"],
  ["=COUNTIF('Input_Template'!G2:G101,\"Online\")+COUNTIF('Input_Template'!G2:G101,\"Lab\")+COUNTIF('Input_Template'!G2:G101,\"Laboratory\")+COUNTIF('Input_Template'!G2:G101,\"Laboratories\")"],
  ["=COUNTIF('Input_Template'!L2:L101,\"*lab*\")"],
  ["=COUNTIF('Input_Template'!K2:K101,\"Online\")"],
  ["=COUNTIF('Remarks_(optional)'!F2:F101,\"Fixed\")"],
  ["=COUNTBLANK('Input_Template'!A2:A101)+COUNTBLANK('Input_Template'!B2:B101)+COUNTBLANK('Input_Template'!C2:C101)+COUNTBLANK('Input_Template'!D2:D101)+COUNTBLANK('Input_Template'!E2:E101)+COUNTBLANK('Input_Template'!G2:G101)+COUNTBLANK('Input_Template'!I2:I101)+COUNTBLANK('Input_Template'!J2:J101)+COUNTBLANK('Input_Template'!K2:K101)+COUNTBLANK('Input_Template'!L2:L101)+COUNTBLANK('Input_Template'!M2:M101)+COUNTBLANK('Input_Template'!N2:N101)+COUNTBLANK('Input_Template'!P2:P101)"],
];
qualitySheet.getRange("A2:A10").format = {
  fill: "#DDEBF7",
  font: { bold: true, color: "#17365D" },
};
qualitySheet.getRange("A14:C14").values = [["Programme", "Distinct module rows", "Status"]];
qualitySheet.getRange("A14:C14").format = {
  fill: "#2F75B5",
  font: { bold: true, color: "#FFFFFF" },
};
qualitySheet.getRange("A15:A34").values = data.summary.programmes.map((programme) => [programme]);
qualitySheet.getRange("B15:B34").formulas = data.summary.programmes.map((_, index) => [
  `=COUNTIF('Input_Template'!$B$2:$B$101,A${15 + index})`,
]);
qualitySheet.getRange("C15:C34").formulas = data.summary.programmes.map((_, index) => [
  `=IF(B${15 + index}>=5,"PASS","REVIEW")`,
]);
qualitySheet.getRange("B2").conditionalFormats.add("containsText", {
  text: "PASS",
  format: { fill: "#C6EFCE", font: { bold: true, color: "#006100" } },
});
qualitySheet.getRange("B2").conditionalFormats.add("containsText", {
  text: "REVIEW",
  format: { fill: "#FFC7CE", font: { bold: true, color: "#9C0006" } },
});
qualitySheet.getRange("C15:C34").conditionalFormats.add("containsText", {
  text: "PASS",
  format: { fill: "#C6EFCE", font: { bold: true, color: "#006100" } },
});
qualitySheet.getRange("C15:C34").conditionalFormats.add("containsText", {
  text: "REVIEW",
  format: { fill: "#FFC7CE", font: { bold: true, color: "#9C0006" } },
});
qualitySheet.getRange("A2:B10").format.borders = {
  insideHorizontal: { style: "thin", color: "#B4C7E7" },
  bottom: { style: "thin", color: "#8EA9DB" },
};
qualitySheet.getRange("A14:C34").format.borders = {
  insideHorizontal: { style: "thin", color: "#D9E2F3" },
  bottom: { style: "thin", color: "#AAB7C4" },
};
qualitySheet.getRange("A1:A34").format.columnWidth = 44;
qualitySheet.getRange("B1:B34").format.columnWidth = 22;
qualitySheet.getRange("C1:C34").format.columnWidth = 16;
qualitySheet.getRange("D1:D34").format.columnWidth = 4;
qualitySheet.getRange("B4:B10").format.numberFormat = "0";
qualitySheet.freezePanes.freezeRows(1);

const inputInspect = await workbook.inspect({
  kind: "table",
  range: "Input_Template!A1:V12",
  include: "values,formulas",
  tableMaxRows: 12,
  tableMaxCols: 22,
  maxChars: 12000,
});
const inputTailInspect = await workbook.inspect({
  kind: "table",
  range: "Input_Template!A92:V101",
  include: "values,formulas",
  tableMaxRows: 10,
  tableMaxCols: 22,
  maxChars: 10000,
});
const qualityInspect = await workbook.inspect({
  kind: "table",
  range: "Quality_Check!A1:C34",
  include: "values,formulas",
  tableMaxRows: 34,
  tableMaxCols: 3,
  maxChars: 12000,
});
const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});

await fs.writeFile(
  path.join(outputDir, "workbook_inspection.ndjson"),
  [inputInspect.ndjson, inputTailInspect.ndjson, qualityInspect.ndjson, formulaErrors.ndjson].join("\n"),
);

const previews = [
  ["Input_Template", "A1:V24", "preview_input_template.png"],
  ["Remarks_(optional)", "A1:R24", "preview_remarks_optional.png"],
  ["README", "A1:B12", "preview_readme.png"],
  ["Quality_Check", "A1:C34", "preview_quality_check.png"],
];
for (const [sheetName, range, filename] of previews) {
  const preview = await workbook.render({ sheetName, range, scale: 1.2, format: "png" });
  await fs.writeFile(path.join(outputDir, filename), new Uint8Array(await preview.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

const verification = JSON.parse(
  runPython(verifierPython, [backendRoot, outputPath], { executable: backendPython, timeout: 240_000 }),
);
const finalSummary = { ...data.summary, verification };
await fs.writeFile(path.join(outputDir, "validation_summary.json"), JSON.stringify(finalSummary, null, 2));

console.log(JSON.stringify({ outputPath, summary: finalSummary }, null, 2));
