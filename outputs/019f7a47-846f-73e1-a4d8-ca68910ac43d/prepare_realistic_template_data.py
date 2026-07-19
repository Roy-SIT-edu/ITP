from __future__ import annotations

import json
import pathlib
import re
import sqlite3
import sys
import unicodedata
from collections import OrderedDict, defaultdict


DATA_DIR = pathlib.Path(sys.argv[1])
INVENTORY_PATH = pathlib.Path(sys.argv[2])
LAB_SEED_PATH = pathlib.Path(sys.argv[3])

STANDARD_WEEKS = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13]
TUTORIAL_WEEKS = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
ALLOWED_CLASS_TYPES = {"Lecture", "Lectorial", "Tutorial", "Workshop", "Seminar", "Quiz"}
ACTIVITY_ALIASES = {
    "lecture": "Lecture",
    "lectorial": "Lectorial",
    "tutorial": "Tutorial",
    "workshop": "Workshop",
    "seminar": "Seminar",
    "quiz": "Quiz",
}

# These 20 programmes were reconciled against the current admin databases.
# Every selected module is active in term 2520 and every derived P1 group is
# part of the original admin set (IDs 1-228), never the generated P51-P55 set.
SELECTED_MODULES = OrderedDict(
    [
        ("ACC", ["ACC1023", "ACC1024", "ACC1025", "ACC1026", "ACC3011"]),
        ("ASE", ["ASE1101", "ASE1201", "ASE1202", "ASE2210", "ASE3106"]),
        ("ATM", ["ATM1104", "ATM1105", "ATM1106", "ATM3301", "ATM3302"]),
        ("BAC", ["BAC2001", "BAC2002", "BAC2005", "BAC3003A", "BAC3004"]),
        ("CDM", ["DCM1011", "DCM1021", "DCM1032", "DCM1033", "DCM2001"]),
        ("CEG", ["CEG1007", "CEG1009", "CEG2005", "CEG2006", "CEG2009"]),
        ("CVE", ["CVE1222", "CVE1242", "CVE1261", "CVE3221", "CVE3222"]),
        ("DSC", ["DSC2203", "DSC3201", "DSC3202", "DSC3302", "DSC3303"]),
        ("EDE", ["EDE1021", "EDE1022", "EDE1023", "EDE1024", "EDE2021"]),
        ("EPE", ["EPE1301", "EPE1302", "EPE1303", "EPE3301", "EPE3303A"]),
        ("ESE", ["ESE1101", "ESE1109", "ESE2103", "ESE3103", "ESE3104"]),
        ("FDT", ["FDT1012", "FDT1013", "FDT1021", "FDT2011", "FDT2013"]),
        ("ICT", ["ICT1012", "ICT1013", "ICT2112", "ICT2113", "ICT2114"]),
        ("MDME", ["MME1222", "MME1262", "MME1271", "MME3201A", "MME3291"]),
        ("MEC", ["MEC1223", "MEC1241", "MEC2261", "MEC2282", "MEC3271"]),
        ("NAME", ["NME1106", "NME1108", "NME1109", "NME2104", "NME2106"]),
        ("RSE", ["RSE1102", "RSE1202", "RSE1801", "RSE3601A", "RSE3601B"]),
        ("SBE", ["SBE1101", "SBE3113A", "SBE3124", "SBE3131", "SBE3132"]),
        ("SLT", ["SLT1203", "SLT1204", "SLT2203", "SLT2204", "SLT3202"]),
        ("TCE", ["TCE1043", "TCE1048", "TCE1049", "TCE2025", "TCE2040"]),
    ]
)

MODULE_PREFIX = {"CDM": "DCM", "MDME": "MME", "NAME": "NME"}


def db_rows(db_name: str, query: str) -> list[dict]:
    connection = sqlite3.connect(DATA_DIR / f"{db_name}.db")
    try:
        connection.row_factory = sqlite3.Row
        return [dict(row) for row in connection.execute(query).fetchall()]
    finally:
        connection.close()


def clean(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.casefold() in {"nan", "none", "null", "na", "n/a"}:
        return None
    return text


def normalize_name(value: str | None) -> str:
    ascii_text = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", " ", ascii_text.casefold()).strip()


def activity_name(value: str | None) -> str | None:
    token = normalize_name(value)
    return ACTIVITY_ALIASES.get(token)


def numeric_weeks(value: str | None) -> list[int]:
    text = clean(value)
    if not text:
        return []
    lowered = text.casefold()
    # Full dates and clock times in historical block-teaching rows are not
    # reliable week lists. Those rows receive the standard numeric pattern.
    if any(token in lowered for token in [":", " am", " pm", "monday", "tuesday", "wednesday", "thursday", "friday"]):
        return []
    numbers = [int(value) for value in re.findall(r"(?<!\d)(\d{1,2})(?!\d)", text)]
    return sorted({week for week in numbers if 1 <= week <= 13})


def normalize_delivery(value: str | None) -> str:
    token = normalize_name(value)
    if "asynchronous" in token or token == "async":
        return "Asynchronous"
    if "online" in token:
        return "Online"
    return "Face-to-face"


def duration_hours(activity: str, remarks: str | None) -> float:
    defaults = {
        "Lecture": 2.0,
        "Lectorial": 2.0,
        "Tutorial": 2.0,
        "Workshop": 3.0,
        "Seminar": 2.0,
        "Quiz": 1.0,
    }
    text = clean(remarks) or ""
    matches = re.findall(r"(?<!\d)(\d(?:\.5)?)\s*(?:-\s*)?(?:hours?|hrs?|hr)\b", text, flags=re.IGNORECASE)
    if matches:
        candidate = float(matches[0])
        if candidate in {1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0}:
            return candidate
    return defaults[activity]


def repeat_count(remarks: str | None, historical_basis: str) -> int:
    if historical_basis != "Exact historical module":
        return 1
    text = clean(remarks) or ""
    return 2 if re.search(r"\b2\s*[x×]\s*2\s*(?:-\s*)?(?:hours?|hrs?|hr)\b", text, flags=re.IGNORECASE) else 1


def module_year(programme: dict, programme_code: str, module_code: str) -> int:
    prefix = MODULE_PREFIX.get(programme_code, programme_code)
    suffix = module_code[len(prefix) :] if module_code.upper().startswith(prefix.upper()) else module_code
    match = re.search(r"(\d)", suffix)
    raw = int(match.group(1)) if match else 1
    return max(1, min(raw, int(programme.get("years") or 1)))


def row_score(row: dict) -> tuple[int, int, int, int]:
    weeks = numeric_weeks(row.get("teaching_weeks"))
    staff_count = sum(1 for item in row.get("staff") or [] if clean(item.get("name")) or clean(item.get("id")))
    current_name_index = globals().get("staff_by_name", {})
    matched_staff_count = sum(
        1
        for item in row.get("staff") or []
        if current_name_index.get(normalize_name(clean(item.get("name"))))
    )
    return (matched_staff_count, len(weeks), 1 if clean(row.get("delivery_mode")) else 0, staff_count)


def best_row(rows: list[dict], activity: str) -> dict | None:
    candidates = [row for row in rows if activity_name(row.get("activity")) == activity]
    return max(candidates, key=row_score) if candidates else None


def source_module_prefix(module_code: str | None) -> str:
    match = re.match(r"([A-Z]+)", (module_code or "").upper())
    return match.group(1) if match else ""


programmes = {row["code"]: row for row in db_rows("programmes", "select id, code, name, years from programmes")}
module_rows = db_rows(
    "modules",
    "select id, module_code, module_title, term, active from modules order by module_code",
)
modules = {row["module_code"].upper(): row for row in module_rows}
group_rows = db_rows(
    "student_groups",
    "select id, group_code, programme_id, year, size from student_groups order by id",
)
staff_rows = db_rows(
    "staff",
    "select id, staff_name, staff_id from staff where staff_name is not null and staff_id is not null order by staff_id, id",
)

inventory = json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))
historical_rows = []
for item in inventory.get("normalizedRows", []):
    activity = activity_name(item.get("activity"))
    if activity in ALLOWED_CLASS_TYPES:
        historical_rows.append({**item, "normalized_activity": activity})

history_by_module: dict[str, list[dict]] = defaultdict(list)
for row in historical_rows:
    module_code = (clean(row.get("module_code")) or "").upper()
    if module_code:
        history_by_module[module_code].append(row)

programme_history: dict[str, list[dict]] = defaultdict(list)
for programme_code in SELECTED_MODULES:
    expected_prefix = MODULE_PREFIX.get(programme_code, programme_code)
    prefix_rows = []
    raw_label_rows = []
    for row in historical_rows:
        module_code = (clean(row.get("module_code")) or "").upper()
        raw_programme = (clean(row.get("programme_year_raw")) or "").upper()
        if source_module_prefix(module_code) == expected_prefix:
            prefix_rows.append(row)
        elif re.search(rf"\b{re.escape(programme_code)}\b", raw_programme):
            raw_label_rows.append(row)
    # Prefer the programme's own workbook as well as its module family. This
    # avoids borrowing a same-prefix combined/common row from another cohort's
    # workbook when a dedicated programme workbook is available.
    own_file_rows = [
        row
        for row in prefix_rows
        if programme_code in (clean(row.get("source_file")) or "").upper()
    ]
    programme_history[programme_code].extend(own_file_rows or prefix_rows or raw_label_rows)

lab_staff_names: set[str] = set()
if LAB_SEED_PATH.exists():
    lab_seed = json.loads(LAB_SEED_PATH.read_text(encoding="ascii"))
    for requirement in lab_seed.get("lab_requirements", []):
        for part in re.split(r"[;]+", requirement.get("staff_names") or ""):
            if clean(part):
                lab_staff_names.add(normalize_name(part))

staff_by_name: dict[str, list[dict]] = defaultdict(list)
for row in staff_rows:
    staff_by_name[normalize_name(row["staff_name"])].append(row)

programme_staff_candidates: dict[str, list[dict]] = defaultdict(list)
for programme_code, rows in programme_history.items():
    seen_staff_ids: set[str] = set()
    for history_row in rows:
        for historical_staff in history_row.get("staff") or []:
            candidates = staff_by_name.get(normalize_name(clean(historical_staff.get("name"))), [])
            if not candidates:
                continue
            candidate = candidates[0]
            if candidate["staff_id"] not in seen_staff_ids:
                programme_staff_candidates[programme_code].append(candidate)
                seen_staff_ids.add(candidate["staff_id"])

fallback_staff = [
    row
    for row in staff_rows
    if normalize_name(row["staff_name"]) not in lab_staff_names
    and not any(token in normalize_name(row["staff_name"]) for token in ["temp staff", "tbc", "adjunct"])
]
fallback_index = 0


def matched_staff(source_row: dict | None, module_fallback: dict) -> list[dict]:
    matches: list[dict] = []
    seen_ids: set[str] = set()
    for historical in (source_row or {}).get("staff") or []:
        name = clean(historical.get("name"))
        candidates = staff_by_name.get(normalize_name(name), [])
        if candidates:
            chosen = candidates[0]
            if chosen["staff_id"] not in seen_ids:
                matches.append(chosen)
                seen_ids.add(chosen["staff_id"])
        if len(matches) == 4:
            break
    return matches or [module_fallback]


def complement_activity(primary: str) -> str:
    return {
        "Lecture": "Tutorial",
        "Lectorial": "Tutorial",
        "Tutorial": "Lecture",
        "Workshop": "Seminar",
        "Seminar": "Tutorial",
    }.get(primary, "Tutorial")


def pattern_rows_for_module(programme_code: str, module_code: str, module_index: int) -> tuple[list[dict], str]:
    direct = history_by_module.get(module_code.upper(), [])
    if direct:
        return direct, "Exact historical module"

    pool = programme_history.get(programme_code, [])
    by_source: dict[str, list[dict]] = defaultdict(list)
    for row in pool:
        source_code = (clean(row.get("module_code")) or "").upper()
        if source_code:
            by_source[source_code].append(row)
    source_codes = sorted(by_source)
    if source_codes:
        return by_source[source_codes[module_index % len(source_codes)]], "Programme pattern adapted"
    return [], "General ENG pattern adapted"


def generic_source(activity: str, module: dict, programme_code: str, module_index: int) -> dict:
    delivery = "Online" if activity == "Lecture" and module_index == 0 else "Face-to-face"
    weeks = TUTORIAL_WEEKS if activity in {"Tutorial", "Seminar"} else STANDARD_WEEKS
    return {
        "source_file": "Requirements Template_ENG.xlsx + current admin module database",
        "source_row": int(module["id"]) + 2,
        "teaching_weeks": ",".join(str(week) for week in weeks),
        "delivery_mode": delivery,
        "remarks": None,
        "staff": [],
        "activity": activity,
    }


required_rows: list[dict] = []
optional_rows: list[dict] = []
module_audit: list[dict] = []


def append_requirement(
    *,
    programme_code: str,
    year: int,
    group: dict,
    module: dict,
    activity: str,
    source_row: dict,
    historical_basis: str,
    module_fallback: dict,
    module_index: int,
    sequence: int,
    repeat_sequence: int = 1,
    force_face_to_face: bool = False,
) -> None:
    source_delivery = normalize_delivery(source_row.get("delivery_mode"))
    allow_virtual = module_index == 0 and activity in {"Lecture", "Lectorial"}
    delivery = source_delivery if allow_virtual and not force_face_to_face else "Face-to-face"
    campus = "Virtual" if delivery in {"Online", "Asynchronous"} else "Physical"
    venue = "Virtual" if campus == "Virtual" else ("Lectorial" if activity in {"Lecture", "Lectorial", "Quiz"} else "Seminar Room")
    weeks = numeric_weeks(source_row.get("teaching_weeks"))
    if not weeks:
        if activity == "Quiz":
            weeks = [6]
        elif activity in {"Tutorial", "Seminar"}:
            weeks = TUTORIAL_WEEKS
        else:
            weeks = STANDARD_WEEKS
    staff = matched_staff(source_row, module_fallback)
    activity_code = {"Lecture": "LEC", "Lectorial": "LCT", "Tutorial": "TUT", "Workshop": "WKS", "Seminar": "SEM", "Quiz": "QZ"}[activity]
    suffix = chr(64 + repeat_sequence) if repeat_sequence > 1 else ""
    requirement_id = f"REQ-{programme_code}-{module['module_code']}-{activity_code}-{sequence:02d}{suffix}"

    staff_cells = {}
    for index in range(1, 5):
        item = staff[index - 1] if index <= len(staff) else None
        staff_cells[f"Staff {index} Name"] = item["staff_name"] if item else None
        staff_cells[f"Staff {index} ID"] = item["staff_id"] if item else None

    required_rows.append(
        {
            "Requirement ID": requirement_id,
            "Programme": programme_code,
            "Year": year,
            "Student Group Code": group["group_code"],
            "Module Code": module["module_code"],
            "Module Title": module.get("module_title") or module["module_code"],
            "Class Type": activity,
            "Session Count": 1,
            "Duration Hours": duration_hours(activity, source_row.get("remarks")),
            "Sessions Per Week": 1,
            "Delivery Mode": delivery,
            "Venue Type Required": venue,
            "Campus Mode": campus,
            "Exact Class Size": int(group["size"]),
            **staff_cells,
            "Source File": clean(source_row.get("source_file")) or "Requirements Template_ENG.xlsx",
            "Source Row No": max(2, int(source_row.get("source_row") or module["id"] + 2)),
        }
    )
    optional_rows.append(
        {
            "Requirement ID": requirement_id,
            "Start Week": min(weeks),
            "End Week": max(weeks),
            "Week Pattern": "Custom",
            "Custom Weeks": ",".join(str(week) for week in weeks),
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
            "Remarks": None,
        }
    )


clean_groups: dict[tuple[str, int], dict] = {}
programme_id_to_code = {row["id"]: row["code"] for row in programmes.values()}
for row in group_rows:
    code = programme_id_to_code.get(row["programme_id"])
    if not code or int(row["id"]) > 228:
        continue
    if re.fullmatch(rf"{re.escape(code)} Y\d+ P1", row["group_code"], flags=re.IGNORECASE):
        clean_groups[(code, int(row["year"]))] = row

for programme_code, module_codes in SELECTED_MODULES.items():
    if programme_code not in programmes:
        raise SystemExit(f"Programme {programme_code} is missing from the current admin database.")
    programme = programmes[programme_code]
    programme_quiz_added = False

    for module_index, module_code in enumerate(module_codes):
        module = modules.get(module_code.upper())
        if not module:
            raise SystemExit(f"Module {module_code} is missing from the current admin database.")
        if str(module.get("active")) not in {"1", "True", "true"} or str(module.get("term") or "") != "2520":
            raise SystemExit(f"Module {module_code} is not an active term-2520 admin module.")
        year = module_year(programme, programme_code, module_code)
        group = clean_groups.get((programme_code, year))
        if not group:
            raise SystemExit(f"Clean admin group {programme_code} Y{year} P1 is missing.")
        if re.search(r"\sP5[1-5]$", group["group_code"], flags=re.IGNORECASE):
            raise SystemExit(f"Synthetic student group was selected: {group['group_code']}")
        if int(group.get("size") or 0) <= 0:
            raise SystemExit(f"Admin group {group['group_code']} has no valid size.")

        programme_candidates = programme_staff_candidates.get(programme_code, [])
        if programme_candidates:
            module_fallback = programme_candidates[module_index % len(programme_candidates)]
        else:
            module_fallback = fallback_staff[fallback_index]
            fallback_index += 1
        patterns, historical_basis = pattern_rows_for_module(programme_code, module_code, module_index)
        available_base = [
            activity
            for activity in ["Lecture", "Lectorial", "Workshop", "Seminar", "Tutorial"]
            if best_row(patterns, activity)
        ]
        if available_base:
            primary_activity = available_base[0]
            secondary_activity = next((item for item in ["Tutorial", "Lectorial", "Workshop", "Seminar", "Lecture"] if item != primary_activity and best_row(patterns, item)), None)
            secondary_activity = secondary_activity or complement_activity(primary_activity)
        else:
            generic_pairs = [
                ("Lecture", "Tutorial"),
                ("Lectorial", "Tutorial"),
                ("Lecture", "Tutorial"),
                ("Workshop", "Seminar"),
                ("Lecture", "Tutorial"),
            ]
            primary_activity, secondary_activity = generic_pairs[module_index]

        selected_activities = [primary_activity, secondary_activity]
        module_row_start = len(required_rows)
        sequence = 1
        for activity_index, activity in enumerate(selected_activities):
            source = best_row(patterns, activity) or generic_source(activity, module, programme_code, module_index)
            repeats = repeat_count(source.get("remarks"), historical_basis)
            for repeat_index in range(1, repeats + 1):
                append_requirement(
                    programme_code=programme_code,
                    year=year,
                    group=group,
                    module=module,
                    activity=activity,
                    source_row=source,
                    historical_basis=historical_basis,
                    module_fallback=module_fallback,
                    module_index=module_index,
                    sequence=sequence,
                    repeat_sequence=repeat_index if repeats > 1 else 1,
                    force_face_to_face=activity_index > 0,
                )
                sequence += 1

        quiz_source = best_row(patterns, "Quiz")
        should_add_quiz = False
        if not programme_quiz_added and quiz_source:
            should_add_quiz = True
        elif not programme_quiz_added and module_index == 2:
            quiz_source = generic_source("Quiz", module, programme_code, module_index)
            quiz_source["teaching_weeks"] = "6"
            should_add_quiz = True
        if should_add_quiz and quiz_source:
            append_requirement(
                programme_code=programme_code,
                year=year,
                group=group,
                module=module,
                activity="Quiz",
                source_row=quiz_source,
                historical_basis=historical_basis,
                module_fallback=module_fallback,
                module_index=module_index,
                sequence=sequence,
                force_face_to_face=True,
            )
            programme_quiz_added = True

        module_output_rows = required_rows[module_row_start:]
        module_audit.append(
            {
                "Programme": programme_code,
                "Year": year,
                "Admin Student Group": group["group_code"],
                "Admin Group Size": int(group["size"]),
                "Module Code": module["module_code"],
                "Module Title": module.get("module_title") or module["module_code"],
                "Historical Basis": historical_basis,
                "Historical Source(s)": "; ".join(sorted({row["Source File"] for row in module_output_rows})),
            }
        )

if any(not programme_quiz_added for programme_quiz_added in []):
    raise AssertionError("Unreachable guard")

programme_modules = {programme: modules for programme, modules in SELECTED_MODULES.items()}
class_types = sorted({row["Class Type"] for row in required_rows})
delivery_modes = sorted({row["Delivery Mode"] for row in required_rows})
student_groups = sorted({row["Student Group Code"] for row in required_rows})
invalid_class_type_count = sum(
    1
    for row in required_rows
    if row["Class Type"] not in ALLOWED_CLASS_TYPES
    or row["Class Type"].casefold().startswith("online")
    or "lab" in row["Class Type"].casefold()
)
synthetic_group_count = sum(1 for row in required_rows if re.search(r"\sP5[1-5]$", row["Student Group Code"], flags=re.IGNORECASE))
lab_venue_count = sum(1 for row in required_rows if "lab" in row["Venue Type Required"].casefold())

if len(SELECTED_MODULES) != 20 or any(len(codes) < 5 for codes in SELECTED_MODULES.values()):
    raise SystemExit("Programme/module coverage construction failed.")
if invalid_class_type_count or synthetic_group_count or lab_venue_count:
    raise SystemExit("Forbidden class type, venue, or synthetic group was generated.")
if len(required_rows) != len(optional_rows):
    raise SystemExit("Required and optional row counts do not match.")
requirement_ids = [row["Requirement ID"] for row in required_rows]
if len(requirement_ids) != len(set(requirement_ids)):
    raise SystemExit("Duplicate Requirement ID generated.")

summary = {
    "input_row_count": len(required_rows),
    "programme_count": len(SELECTED_MODULES),
    "programmes": list(SELECTED_MODULES),
    "programme_modules": programme_modules,
    "minimum_distinct_modules_per_programme": min(len(codes) for codes in SELECTED_MODULES.values()),
    "class_types": class_types,
    "delivery_modes": delivery_modes,
    "student_groups": student_groups,
    "online_delivery_rows": sum(row["Delivery Mode"] in {"Online", "Asynchronous"} for row in required_rows),
    "fixed_uploaded_rows": sum(row["Scheduling Type"] == "Fixed" for row in optional_rows),
    "invalid_class_type_rows": invalid_class_type_count,
    "lab_venue_rows": lab_venue_count,
    "synthetic_p51_p55_rows": synthetic_group_count,
    "exact_historical_module_count": sum(row["Historical Basis"] == "Exact historical module" for row in module_audit),
    "programme_pattern_adapted_count": sum(row["Historical Basis"] == "Programme pattern adapted" for row in module_audit),
    "general_pattern_adapted_count": sum(row["Historical Basis"] == "General ENG pattern adapted" for row in module_audit),
}

print(
    json.dumps(
        {
            "required": required_rows,
            "optional": optional_rows,
            "module_audit": module_audit,
            "summary": summary,
        },
        ensure_ascii=False,
    )
)
