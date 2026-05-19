from __future__ import annotations

import math
import re

DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
ALLOWED_WEEK_PATTERNS = {"weekly", "odd", "even", "custom"}
ALLOWED_DELIVERY_MODES = {
    "face-to-face",
    "face to face",
    "f2f",
    "online",
    "online synchronous",
    "hybrid",
    "asynchronous",
    "online asynchronous",
    "async",
}


def clean_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null", "na", "<na>", "nat"}:
        return None
    return text


def normalize_token(value: object) -> str:
    text = clean_text(value) or ""
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def canonical_day(value: object) -> str | None:
    token = normalize_token(value)
    if not token:
        return None
    aliases = {
        "mon": "Monday",
        "monday": "Monday",
        "tue": "Tuesday",
        "tues": "Tuesday",
        "tuesday": "Tuesday",
        "wed": "Wednesday",
        "wednesday": "Wednesday",
        "thu": "Thursday",
        "thur": "Thursday",
        "thurs": "Thursday",
        "thursday": "Thursday",
        "fri": "Friday",
        "friday": "Friday",
    }
    return aliases.get(token, value.title() if isinstance(value, str) else None)


def canonical_week_pattern(value: object) -> str | None:
    token = normalize_token(value)
    if not token:
        return None
    if token in {"weekly", "week"}:
        return "Weekly"
    if token == "odd":
        return "Odd"
    if token == "even":
        return "Even"
    if token == "custom":
        return "Custom"
    return clean_text(value)


def canonical_delivery_mode(value: object) -> str | None:
    token = normalize_token(value)
    if not token:
        return None
    if token in {"face to face", "f2f", "physical", "in person"}:
        return "Face-to-face"
    if token in {"online", "online synchronous", "synchronous", "sync"}:
        return "Online"
    if token == "hybrid":
        return "Hybrid"
    if token in {"asynchronous", "async", "online asynchronous"}:
        return "Asynchronous"
    return clean_text(value)


def parse_day_list(value: object) -> list[str]:
    text = clean_text(value)
    if not text:
        return []
    parts = re.split(r"[,;/|]+|\band\b", text, flags=re.IGNORECASE)
    days = []
    for part in parts:
        day = canonical_day(part.strip())
        if day:
            days.append(day)
    return days


def parse_custom_weeks(value: object) -> list[int]:
    text = clean_text(value)
    if not text:
        return []
    return [int(match) for match in re.findall(r"\d+", text)]


def time_to_minutes(value: object) -> int | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        numeric = float(value)
        if math.isnan(numeric):
            return None
        if 0 <= numeric < 1:
            return round(numeric * 24 * 60)
        if numeric.is_integer():
            value = int(numeric)
    text = clean_text(value)
    if not text:
        return None
    if hasattr(value, "hour") and hasattr(value, "minute"):
        return int(value.hour) * 60 + int(value.minute)
    compact = re.sub(r"\D", "", text)
    if len(compact) in {3, 4} and ":" not in text:
        hour = int(compact[:-2])
        minute = int(compact[-2:])
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return hour * 60 + minute
    match = re.search(r"(\d{1,2})(?::(\d{2}))?", text)
    if not match:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2) or 0)
    return hour * 60 + minute


def minutes_to_time(value: int) -> str:
    hour, minute = divmod(value, 60)
    return f"{hour:02d}:{minute:02d}"


def intervals_overlap(start_a: str, end_a: str, start_b: str, end_b: str) -> bool:
    a_start = time_to_minutes(start_a)
    a_end = time_to_minutes(end_a)
    b_start = time_to_minutes(start_b)
    b_end = time_to_minutes(end_b)
    if None in {a_start, a_end, b_start, b_end}:
        return False
    return a_start < b_end and b_start < a_end


def weeks_conflict(pattern_a: object, pattern_b: object) -> bool:
    a = normalize_token(pattern_a or "Weekly")
    b = normalize_token(pattern_b or "Weekly")
    if {a, b} == {"odd", "even"}:
        return False
    return True


def slot_conflicts(slot_a, slot_b) -> bool:
    return (
        slot_a.day == slot_b.day
        and weeks_conflict(slot_a.week_pattern, slot_b.week_pattern)
        and intervals_overlap(
            slot_a.start_time,
            slot_a.end_time,
            slot_b.start_time,
            slot_b.end_time,
        )
    )


def is_online_mode(value: object) -> bool:
    return normalize_token(value) in {"online", "asynchronous", "async"}


def is_face_to_face_mode(value: object) -> bool:
    return normalize_token(value) in {"face to face", "f2f", "physical", "in person"}


def delivery_room_compatible(session, room) -> bool:
    mode = normalize_token(getattr(session, "delivery_mode", ""))
    campus_mode = normalize_token(getattr(session, "campus_mode", ""))
    is_virtual = bool(getattr(room, "is_virtual", False))

    if mode in {"online", "asynchronous", "async"}:
        return is_virtual
    if mode in {"face to face", "f2f", "physical", "in person"}:
        return not is_virtual
    if mode == "hybrid":
        if campus_mode in {"online", "virtual", "remote"}:
            return is_virtual
        if campus_mode in {"physical", "campus", "on campus", "face to face"}:
            return not is_virtual
        return True
    return True


def venue_room_compatible(session, room) -> bool:
    venue = normalize_token(getattr(session, "venue_type_required", ""))
    room_type = normalize_token(getattr(room, "room_type", ""))
    if not venue:
        return True
    if getattr(room, "is_virtual", False):
        return "virtual" in venue or is_online_mode(getattr(session, "delivery_mode", ""))
    if "virtual" in venue or "online" in venue:
        return bool(getattr(room, "is_virtual", False))
    if "lab" in venue:
        return "lab" in room_type
    if "lect" in venue:
        return "lect" in room_type
    if any(token in venue for token in ["class", "tutorial", "seminar"]):
        return any(token in room_type for token in ["class", "tutorial", "seminar"])
    return True


def room_capacity_fits(session, room) -> bool:
    class_size = getattr(session, "exact_class_size", None)
    if class_size is None:
        return True
    return int(getattr(room, "capacity", 0) or 0) >= int(class_size)
