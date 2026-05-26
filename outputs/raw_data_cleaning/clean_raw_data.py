from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd


RAW_PATH = Path(r"C:/Users/Admin/Downloads/Raw Data.xlsx")
OUT_DIR = Path(r"C:/Users/Admin/Desktop/Code/Codes/INF1009/ITP/outputs/raw_data_cleaning")
OUT_JSON = OUT_DIR / "cleaned_raw_data.json"


def clean_text(value):
    if pd.isna(value):
        return None
    text = str(value).strip()
    if not text or text.lower() in {"nan", "n.a", "n.a.", "na", "n/a", "none"}:
        return None
    text = re.sub(r"\s+", " ", text)
    return text


def clean_staff_name(value):
    text = clean_text(value)
    if text is None:
        return None
    text = re.sub(r"\s*\.+\s*$", "", text).strip()
    return re.sub(r"\s+", " ", text)


def to_int(value):
    text = clean_text(value)
    if text is None:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def yes_no(value, default=False):
    text = clean_text(value)
    if text is None:
        return default
    lowered = text.lower()
    if lowered in {"yes", "y", "true", "1", "checked"}:
        return True
    if lowered in {"no", "n", "false", "0", "unchecked"}:
        return False
    return default


def infer_room_type(resource_type=None, suitability=None, name=None):
    text = " ".join(filter(None, [clean_text(resource_type), clean_text(suitability), clean_text(name)])).lower()
    if "lecture theatre" in text or "lector" in text or re.search(r"\blt\b", text):
        return "Lecture Theatre"
    if "seminar" in text or re.search(r"\bsr\b", text):
        return "Seminar Room"
    if "laboratory" in text or "lab" in text:
        return "Laboratory"
    if "external" in text:
        return "External Venue"
    if "teaching" in text:
        return "Teaching Facility"
    return clean_text(resource_type) or "Teaching Facility"


def load_sheet(name):
    frame = pd.read_excel(RAW_PATH, sheet_name=name)
    frame = frame.dropna(how="all")
    frame.columns = [str(column).strip() for column in frame.columns]
    return frame


def clean_rooms():
    campus = load_sheet("Campus Restrictions")
    non_campus = load_sheet("Non-Campus Restrictions")
    rooms = []
    excluded = []

    for index, row in campus.iterrows():
        code = clean_text(row.get("Location Name"))
        capacity = to_int(row.get("Capacity"))
        if not code:
            continue
        if capacity is None:
            excluded.append(
                {
                    "source_sheet": "Campus Restrictions",
                    "source_row": int(index) + 2,
                    "record_key": code,
                    "reason": "Missing numeric room capacity",
                }
            )
            continue
        rooms.append(
            {
                "room_code": code,
                "room_name": clean_text(row.get("Location Description")) or code,
                "room_type": infer_room_type(row.get("Resource Type"), name=code),
                "capacity": capacity,
                "is_virtual": False,
                "campus_mode": "Physical",
                "recording_available": yes_no(row.get("Recording")),
                "_source_sheet": "Campus Restrictions",
                "_source_row": int(index) + 2,
            }
        )

    for index, row in non_campus.iterrows():
        code = clean_text(row.get("Host Key")) or clean_text(row.get("Name"))
        name = clean_text(row.get("Name")) or code
        capacity = to_int(row.get("Capacity"))
        if not code:
            continue
        if capacity is None:
            excluded.append(
                {
                    "source_sheet": "Non-Campus Restrictions",
                    "source_row": int(index) + 2,
                    "record_key": code,
                    "reason": "Missing numeric room capacity",
                }
            )
            continue
        suitability = clean_text(row.get("Primary Suitabilities"))
        rooms.append(
            {
                "room_code": code,
                "room_name": name,
                "room_type": infer_room_type(suitability=suitability, name=code),
                "capacity": capacity,
                "is_virtual": code.upper().startswith("CEFT EXTERNAL"),
                "campus_mode": "External" if code.upper().startswith("CEFT EXTERNAL") else "Physical",
                "recording_available": bool(suitability and "recording" in suitability.lower()),
                "_source_sheet": "Non-Campus Restrictions",
                "_source_row": int(index) + 2,
            }
        )

    deduped = {}
    duplicates = []
    for room in rooms:
        key = room["room_code"].lower()
        if key in deduped:
            duplicates.append(
                {
                    "source_sheet": room["_source_sheet"],
                    "source_row": room["_source_row"],
                    "record_key": room["room_code"],
                    "reason": "Duplicate room_code; kept first occurrence",
                }
            )
            continue
        deduped[key] = room

    clean = [
        {key: room[key] for key in ["room_code", "room_name", "room_type", "capacity", "is_virtual", "campus_mode", "recording_available"]}
        for room in sorted(deduped.values(), key=lambda item: item["room_code"])
    ]
    return clean, excluded + duplicates


def clean_staff():
    staff_frame = load_sheet("Staff Information")
    staff = []
    excluded = []
    seen = set()
    for index, row in staff_frame.iterrows():
        host_key = clean_text(row.get("Host Key"))
        name = clean_staff_name(row.get("Name"))
        if not host_key or not name:
            excluded.append(
                {
                    "source_sheet": "Staff Information",
                    "source_row": int(index) + 2,
                    "record_key": host_key or name or "",
                    "reason": "Missing staff name or host key",
                }
            )
            continue
        key = host_key.lower()
        if key in seen:
            excluded.append(
                {
                    "source_sheet": "Staff Information",
                    "source_row": int(index) + 2,
                    "record_key": host_key,
                    "reason": "Duplicate staff_id; kept first occurrence",
                }
            )
            continue
        seen.add(key)
        staff.append({"staff_id": host_key, "staff_name": name, "staff_host_key": host_key})
    return sorted(staff, key=lambda item: (item["staff_name"], item["staff_id"])), excluded


def host_programme(host_key):
    text = clean_text(host_key)
    if not text:
        return None
    parts = text.split("-")
    if len(parts) >= 3:
        return parts[2].upper()
    return None


def clean_modules():
    modules_frame = load_sheet("Module Code")
    modules = []
    excluded = []
    seen = set()
    for index, row in modules_frame.iterrows():
        code = clean_text(row.get("Module Code"))
        host_key = clean_text(row.get("Host Key"))
        if not code:
            excluded.append(
                {
                    "source_sheet": "Module Code",
                    "source_row": int(index) + 2,
                    "record_key": host_key or "",
                    "reason": "Missing module code",
                }
            )
            continue
        key = code.lower()
        if key in seen:
            excluded.append(
                {
                    "source_sheet": "Module Code",
                    "source_row": int(index) + 2,
                    "record_key": code,
                    "reason": "Duplicate module_code; kept first occurrence",
                }
            )
            continue
        seen.add(key)
        term = clean_text(row.get("Term"))
        modules.append(
            {
                "module_code": code.upper(),
                "module_host_key": host_key,
                "module_title": code.upper(),
                "term": str(term) if term is not None else None,
                "_programme_from_host_key": host_programme(host_key),
            }
        )
    modules = sorted(modules, key=lambda item: item["module_code"])
    upload = [
        {key: module[key] for key in ["module_code", "module_host_key", "module_title", "term"]}
        for module in modules
    ]
    return upload, excluded, modules


PROGRAMME_STOPWORDS = {
    "ALL",
    "PROGRAMMES",
    "PROGRAMME",
    "EXCEPT",
    "AND",
    "THE",
    "YEAR",
}


def split_programme_tokens(value):
    text = clean_text(value)
    if text is None:
        return []
    tokens = re.findall(r"\b[A-Z]{2,6}\b", text.upper())
    return [token for token in tokens if token not in PROGRAMME_STOPWORDS]


def clean_common_modules():
    common = load_sheet("Common Modules")
    rows = []
    mappings = []
    for index, row in common.iterrows():
        module_text = clean_text(row.get("Module"))
        if not module_text:
            continue
        modules = [part.strip().upper() for part in re.split(r"/|,", module_text) if part.strip()]
        programmes = split_programme_tokens(row.get("Programmes"))
        base = {
            "module": module_text,
            "year": to_int(row.get("Year")),
            "programmes": clean_text(row.get("Programmes")),
            "remarks": clean_text(row.get("Remarks (if any)")),
        }
        rows.append(base)
        for module in modules:
            for programme in programmes:
                mappings.append(
                    {
                        "module_code": module,
                        "year": base["year"],
                        "programme": programme,
                        "source_programmes_text": base["programmes"],
                        "remarks": base["remarks"],
                    }
                )
    return rows, sorted(mappings, key=lambda item: (item["module_code"], item["programme"]))


def clean_programmes(modules_with_programmes, common_mappings):
    programme_sources = {}
    for module in modules_with_programmes:
        code = module.get("_programme_from_host_key")
        if code:
            programme_sources.setdefault(code, set()).add("Module host key")
    for mapping in common_mappings:
        code = mapping["programme"]
        programme_sources.setdefault(code, set()).add("Common Modules")

    programmes = []
    for code in sorted(programme_sources):
        sources = sorted(programme_sources[code])
        programmes.append(
            {
                "code": code,
                "name": code,
                "cluster": ", ".join(sources),
            }
        )
    return programmes


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rooms, room_excluded = clean_rooms()
    staff, staff_excluded = clean_staff()
    modules, module_excluded, modules_with_programmes = clean_modules()
    common_rows, common_mappings = clean_common_modules()
    programmes = clean_programmes(modules_with_programmes, common_mappings)

    excluded = room_excluded + staff_excluded + module_excluded
    notes = [
        {
            "item": "Source workbook",
            "value": str(RAW_PATH),
        },
        {
            "item": "Cleaned rooms",
            "value": f"{len(rooms)} rows from Campus Restrictions and Non-Campus Restrictions",
        },
        {
            "item": "Cleaned staff",
            "value": f"{len(staff)} rows from Staff Information",
        },
        {
            "item": "Cleaned modules",
            "value": f"{len(modules)} rows from Module Code",
        },
        {
            "item": "Cleaned programmes",
            "value": f"{len(programmes)} programme/host codes inferred from module host keys and common-module mappings",
        },
        {
            "item": "Common module mappings",
            "value": f"{len(common_mappings)} expanded rows retained as reference data; the app has no direct upload tab for this data type",
        },
        {
            "item": "Excluded rows",
            "value": f"{len(excluded)} rows excluded because they were missing required values or duplicate keys",
        },
    ]

    payload = {
        "rooms": rooms,
        "staff": staff,
        "modules": modules,
        "programmes": programmes,
        "common_modules": common_rows,
        "common_module_mappings": common_mappings,
        "excluded_rows": excluded,
        "cleanup_notes": notes,
    }
    OUT_JSON.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps({key: len(value) for key, value in payload.items()}, indent=2))


if __name__ == "__main__":
    main()
