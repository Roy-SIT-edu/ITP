"""Synchronize built-in lab requirements into solver-ready session rows."""

from __future__ import annotations

import re

from app.models.lab_requirement import LabRequirement
from app.models.module import Module
from app.models.programme import Programme
from app.models.room import Room
from app.models.session import Session
from app.models.session_staff import SessionStaff
from app.models.staff import Staff
from app.models.student_group import StudentGroup
from app.services.compatibility import clean_text, parse_custom_weeks
from app.services.seed_service import PROGRAMME_NAMES, PROGRAMME_YEARS
from app.services.student_group_service import ensure_programme_year_groups
from sqlalchemy import func
from sqlalchemy.orm import Session as DbSession

GENERATED_LAB_SOURCE = "Built-in Lab Requirements"

STAFF_ALIASES = {
    "MANICKAM BALAKRISHNAN": "MANICKAM S/O BALAKRISHNAN",
    "NG CHUNWEE": "NG CHUN WEE",
    "SUN WAI HOONG (AF)": "SUN WAI HOONG",
    "SERGE LANDRY ( AF)": "SERGE LANDRY (AF)",
}


class LabRequirementService:
    def active_requirement_ids(self, db: DbSession) -> set[str]:
        return {
            item.requirement_id
            for item in db.query(LabRequirement.requirement_id).filter(LabRequirement.is_active.is_(True)).all()
            if item.requirement_id
        }

    def sync_active_to_sessions(self, db: DbSession) -> set[str]:
        """Create/update generated lab sessions and return active lab requirement IDs."""

        self.normalize_saved_requirements(db)
        active_requirement_ids: set[str] = set()
        existing = {
            item.lab_requirement_id: item
            for item in db.query(Session).filter(Session.is_lab_requirement.is_(True)).all()
            if item.lab_requirement_id is not None
        }
        requirements = db.query(LabRequirement).order_by(LabRequirement.source_sheet, LabRequirement.source_row_no).all()
        for requirement in requirements:
            if not self._can_schedule(requirement):
                continue
            programme = self._programme(db, requirement)
            module = self._module(db, requirement.module_code)
            group_codes = self._resolved_group_codes(db, requirement, programme)
            primary_group = self._student_group(db, group_codes[0], programme, requirement.year, requirement.group_size)
            for code in group_codes[1:]:
                self._student_group(db, code, programme, requirement.year, requirement.group_size)
            staff_members = [self._staff(db, name) for name in self._staff_names(requirement.staff_names)]
            staff_members = [item for item in staff_members if item is not None]
            session = existing.get(requirement.id)
            if session is None:
                session = Session(lab_requirement_id=requirement.id, is_lab_requirement=True)
                db.add(session)
            self._apply_to_session(session, requirement, programme, module, primary_group, staff_members, group_codes)
            db.flush()
            self._replace_staff_assignments(db, session, staff_members)
            active_requirement_ids.add(requirement.requirement_id)
        return active_requirement_ids

    def normalize_saved_requirements(self, db: DbSession) -> int:
        """Keep lab rows consistent for UI display, editing, and solver sync."""

        changed = 0
        for requirement in db.query(LabRequirement).order_by(LabRequirement.id).all():
            before = self._field_snapshot(requirement)
            self._normalize_requirement(db, requirement)
            if self._field_snapshot(requirement) != before:
                changed += 1
        if changed:
            db.flush()
        return changed

    def _field_snapshot(self, requirement: LabRequirement) -> tuple:
        return (
            requirement.requirement_id,
            requirement.is_active,
            requirement.module_code,
            requirement.student_group,
            requirement.student_group_codes,
            requirement.location,
            requirement.required_room_codes,
            requirement.delivery_mode,
            requirement.campus_mode,
            requirement.venue_type_required,
        )

    def _normalize_requirement(self, db: DbSession, requirement: LabRequirement) -> None:
        requirement.is_active = True
        if not clean_text(requirement.requirement_id):
            requirement.requirement_id = f"LAB-ADMIN-{requirement.id or 'NEW'}"
        requirement.module_code = self._module_code(requirement.module_code)
        programme = self._programme(db, requirement)
        group_codes = self._resolved_group_codes(db, requirement, programme)
        for code in group_codes:
            self._student_group(db, code, programme, requirement.year, requirement.group_size)
        requirement.student_group_codes = ", ".join(group_codes)
        requirement.student_group = self._student_group_label(group_codes)
        requirement.required_room_codes = ", ".join(self._eligible_room_codes(db, requirement))
        requirement.location = self._venue_label(requirement.location, requirement.required_room_codes)
        requirement.delivery_mode = requirement.delivery_mode or "Face-to-face"
        requirement.campus_mode = requirement.campus_mode or ("Virtual" if requirement.delivery_mode == "Online" else "Physical")
        requirement.venue_type_required = requirement.venue_type_required or "Lab"

    def _can_schedule(self, requirement: LabRequirement) -> bool:
        return bool(
            requirement.is_active
            and requirement.requirement_id
            and requirement.module_code
            and requirement.fixed_day
            and requirement.fixed_start_time
            and requirement.fixed_end_time
            and requirement.duration_minutes
        )

    def _programme(self, db: DbSession, requirement: LabRequirement) -> Programme | None:
        codes = self._programme_codes(requirement.programme or requirement.raw_programme)
        code = codes[0] if codes else self._programme_from_group_codes(requirement.student_group_codes)
        if not code:
            return None
        programme = db.query(Programme).filter(func.lower(Programme.code) == code.lower()).first()
        if programme:
            return programme
        programme = Programme(
            code=code,
            name=PROGRAMME_NAMES.get(code, code),
            years=PROGRAMME_YEARS.get(code),
        )
        db.add(programme)
        db.flush()
        ensure_programme_year_groups(db, programme)
        return programme

    def _programme_codes(self, value: str | None) -> list[str]:
        codes = []
        for part in re.split(r"[,;/&+]+", clean_text(value) or ""):
            code = clean_text(part)
            if not code:
                continue
            code = code.upper()
            if code in {"Y1", "Y2", "Y3", "Y4", "ALL", "MSTR", "PAX"}:
                continue
            if code == "MET":
                code = "METS"
            if re.fullmatch(r"[A-Z][A-Z0-9]{1,9}", code) and code not in codes:
                codes.append(code)
        return codes

    def _programme_from_group_codes(self, value: str | None) -> str | None:
        first = self._split_codes(value)[0] if self._split_codes(value) else None
        if not first:
            return None
        return first.split()[0].upper()

    def _module_code(self, value: str | None) -> str | None:
        text = clean_text(value)
        if not text:
            return None
        text = text.replace("\u2013", "-").replace("\u2014", "-")
        match = re.match(r"^([A-Z]{2,5}\d{4}(?:/[A-Z]{2,5}\d{4})?)\b", text.strip(), flags=re.IGNORECASE)
        return match.group(1).upper() if match else text

    def _student_group_partitions(self, requirement: LabRequirement) -> list[int]:
        text = " ".join(
            item
            for item in [
                clean_text(requirement.student_group),
                clean_text(requirement.student_group_codes),
            ]
            if item
        )
        if not text:
            return []
        partitions: set[int] = set()
        for start, end in re.findall(r"\bP\s*(\d+)\s*(?:to|-|\u2013|\u2014)\s*P?\s*(\d+)\b", text, flags=re.IGNORECASE):
            left = int(start)
            right = int(end)
            low, high = sorted((left, right))
            partitions.update(range(low, high + 1))
        for value in re.findall(r"\bP\s*(\d+)\b", text, flags=re.IGNORECASE):
            partitions.add(int(value))
        return sorted(partitions)

    def _student_group_label(self, group_codes: list[str]) -> str | None:
        labels = []
        for code in group_codes:
            match = re.search(r"\bY\d+\s+(.+)$", code, flags=re.IGNORECASE)
            label = match.group(1).strip() if match else code
            if label and label not in labels:
                labels.append(label)
        return ", ".join(labels) if labels else None

    def _explicit_room_codes(self, value: str | None) -> list[str]:
        text = clean_text(value)
        if not text:
            return []
        codes = []
        for match in re.findall(
            r"\b[A-Z]\d-[A-Z0-9]{2}-\d{2}\b|\b[A-Z]\d-[A-Z0-9]M-\d{2}\b|\bENG-EXTERNAL\b|\bEXTERNAL-LAB\b", text, flags=re.IGNORECASE
        ):
            code = match.upper()
            if code not in codes:
                codes.append(code)
        return codes

    def _eligible_room_codes(self, db: DbSession, requirement: LabRequirement) -> list[str]:
        location = clean_text(requirement.location) or ""
        required_codes = self._explicit_room_codes(requirement.required_room_codes)
        location_codes = self._explicit_room_codes(location)
        generic_codes = self._generic_room_codes(db, requirement, location)
        codes = [*required_codes, *location_codes, *generic_codes]
        return list(dict.fromkeys(codes))

    def _generic_room_codes(self, db: DbSession, requirement: LabRequirement, location: str) -> list[str]:
        token = location.lower()
        if not any(word in token for word in ("any", "available", "ace", "seminar", "lt", "lecture")):
            return []
        rooms = db.query(Room).order_by(Room.room_code).all()
        filters: list = []
        if "ace" in token:
            filters.append(lambda room: self._is_ace_room(room, requirement.group_size))
        if "seminar" in token:
            filters.append(lambda room: self._is_seminar_room(room))
        if re.search(r"\bLT\b|\blecture\b", location, flags=re.IGNORECASE):
            filters.append(lambda room: self._is_lecture_theatre(room))
        if not filters:
            return []

        eligible = [room for room in rooms if any(predicate(room) for predicate in filters)]
        if "e6" in token and "e2" not in token:
            eligible = [room for room in eligible if room.room_code.upper().startswith("E6-")]
        elif "e2" in token and "e6" not in token:
            eligible = [room for room in eligible if room.room_code.upper().startswith("E2-")]
        elif "e2 or e6" in token or ("e2" in token and "e6" in token):
            eligible = [room for room in eligible if room.room_code.upper().startswith(("E2-", "E6-"))]
        if "level 4" in token:
            eligible = [room for room in eligible if re.match(r"^E2-04-", room.room_code, flags=re.IGNORECASE)]
            project_hub = db.query(Room).filter(func.lower(Room.room_code) == "e2-04-01").first()
            if project_hub and project_hub not in eligible:
                eligible.append(project_hub)
        return [room.room_code for room in eligible]

    def _is_seminar_room(self, room: Room) -> bool:
        return (
            "seminar" in (room.room_type or "").lower()
            or (room.room_name or "").upper().startswith("SR")
            or "seminar" in (room.room_name or "").lower()
        )

    def _is_lecture_theatre(self, room: Room) -> bool:
        return (
            "lectorial" in (room.room_type or "").lower()
            or "lecture" in (room.room_type or "").lower()
            or "lectorial" in (room.room_name or "").lower()
            or (room.room_name or "").upper().startswith("LT")
        )

    def _is_ace_room(self, room: Room, group_size: int | None) -> bool:
        if not room.room_code.upper().startswith(("E2-", "E6-")):
            return False
        if not (self._is_seminar_room(room) or "project" in (room.room_type or "").lower()):
            return False
        return group_size is None or not room.capacity or room.capacity >= group_size

    def _venue_label(self, location: str | None, required_room_codes: str | None) -> str | None:
        text = clean_text(location)
        token = (text or "").lower()
        if "ace" in token:
            return "Eligible ACE Rooms"
        if "seminar" in token and ("any" in token or "available" in token):
            if "e6" in token and "e2" not in token:
                return "Eligible E6 Seminar Rooms"
            if "level 4" in token:
                return "Eligible E2 Level 4 Seminar Rooms"
            return "Eligible Seminar Rooms"
        if re.search(r"\bLT\b|\blecture\b", text or "", flags=re.IGNORECASE) and not self._explicit_room_codes(text):
            return "Eligible Lecture Theatres"
        return text or clean_text(required_room_codes)

    def _module(self, db: DbSession, module_code: str | None) -> Module:
        code = self._module_code(module_code)
        module = db.query(Module).filter(func.lower(Module.module_code) == code.lower()).first()
        if module:
            return module
        module = Module(module_code=code, module_title=code, term="AY25 Tri 1")
        db.add(module)
        db.flush()
        return module

    def _resolved_group_codes(
        self,
        db: DbSession,
        requirement: LabRequirement,
        primary_programme: Programme | None,
    ) -> list[str]:
        codes = self._split_codes(requirement.student_group_codes)
        partitions = self._student_group_partitions(requirement)
        programme_codes = self._programme_codes(requirement.programme or requirement.raw_programme)
        if not programme_codes and primary_programme:
            programme_codes = [primary_programme.code]

        if partitions and programme_codes and requirement.year:
            codes.extend(
                f"{programme_code} Y{requirement.year} P{partition}" for programme_code in programme_codes for partition in partitions
            )
        if not codes and primary_programme and requirement.year:
            suffix = clean_text(requirement.student_group) or "ALL"
            codes = [f"{primary_programme.code} Y{requirement.year} {suffix}"]
        resolved: list[str] = []
        for code in codes:
            if code.upper().endswith(" ALL"):
                resolved.extend(self._partition_group_codes(db, code, primary_programme, requirement.year))
            elif re.search(r"\bP\s*\d+\b", code, flags=re.IGNORECASE):
                resolved.append(re.sub(r"\bP\s*(\d+)\b", r"P\1", code.strip(), flags=re.IGNORECASE))
            else:
                resolved.append(code)
        return list(dict.fromkeys(resolved)) or [f"LAB-GROUP-{requirement.requirement_id}"]

    def _partition_group_codes(
        self,
        db: DbSession,
        all_group_code: str,
        primary_programme: Programme | None,
        year: int | None,
    ) -> list[str]:
        match = re.match(r"^([A-Z][A-Z0-9]*)\s+Y(\d+)\s+ALL$", all_group_code.strip(), re.IGNORECASE)
        programme = primary_programme
        target_year = year
        if match:
            programme_code = match.group(1).upper()
            target_year = int(match.group(2))
            programme = db.query(Programme).filter(func.lower(Programme.code) == programme_code.lower()).first() or programme
        if not programme or target_year is None:
            return []
        ensure_programme_year_groups(db, programme)
        return [
            item.group_code
            for item in db.query(StudentGroup)
            .filter_by(programme_id=programme.id, year=target_year)
            .order_by(StudentGroup.group_code)
            .all()
            if re.search(r"\bP\s*\d+\s*$", item.group_code, re.IGNORECASE)
        ]

    def _student_group(
        self,
        db: DbSession,
        group_code: str,
        default_programme: Programme | None,
        default_year: int | None,
        size: int | None,
    ) -> StudentGroup:
        code = clean_text(group_code) or "LAB-GROUP"
        group = db.query(StudentGroup).filter(func.lower(StudentGroup.group_code) == code.lower()).first()
        if group:
            return group
        programme = default_programme
        year = default_year
        match = re.match(r"^([A-Z][A-Z0-9]*)\s+Y(\d+)\b", code, re.IGNORECASE)
        if match:
            programme = db.query(Programme).filter(func.lower(Programme.code) == match.group(1).lower()).first() or programme
            year = int(match.group(2))
        group = StudentGroup(
            group_code=code,
            programme_id=programme.id if programme else None,
            year=year,
            size=size,
        )
        db.add(group)
        db.flush()
        return group

    def _staff_names(self, value: str | None) -> list[str]:
        names = []
        for part in re.split(r"[;,]+", clean_text(value) or ""):
            name = self._clean_staff_name(part)
            if name and not self._is_placeholder_staff(name) and name not in names:
                names.append(name)
        return names

    def _clean_staff_name(self, value: str | None) -> str | None:
        text = clean_text(value)
        if not text:
            return None
        text = re.sub(r"\s+\.$", "", text).strip()
        text = re.sub(r"\s+", " ", text)
        return STAFF_ALIASES.get(text.upper(), text)

    def _is_placeholder_staff(self, value: str) -> bool:
        key = value.upper()
        return (
            key in {"AF", "AF 1", "AF 2", "AF 3", "AF (CHRIS TEO)", "AF (JONATHAN LIM, TENTATIVE)"}
            or key.startswith("UGS - SUBCONTRACTOR")
            or key.startswith("BUFFER -")
            or key.startswith("ADJUST GROUP SIZE")
        )

    def _staff(self, db: DbSession, name: str) -> Staff | None:
        clean_name = self._clean_staff_name(name)
        if not clean_name:
            return None
        staff = db.query(Staff).filter(func.lower(Staff.staff_name) == clean_name.lower()).first()
        if staff:
            return staff
        staff = Staff(staff_name=clean_name, staff_id=None)
        db.add(staff)
        db.flush()
        return staff

    def _apply_to_session(
        self,
        session: Session,
        requirement: LabRequirement,
        programme: Programme | None,
        module: Module,
        primary_group: StudentGroup,
        staff_members: list[Staff],
        group_codes: list[str],
    ) -> None:
        weeks = parse_custom_weeks(requirement.custom_weeks)
        session.requirement_id = requirement.requirement_id
        session.programme_id = programme.id if programme else None
        session.module_id = module.id
        session.student_group_id = primary_group.id
        session.staff_id = staff_members[0].id if staff_members else None
        session.class_type = requirement.class_type or "Lab"
        session.delivery_mode = requirement.delivery_mode or "Face-to-face"
        session.campus_mode = requirement.campus_mode or ("Virtual" if session.delivery_mode == "Online" else "Physical")
        session.venue_type_required = requirement.venue_type_required or "Lab"
        session.duration_minutes = requirement.duration_minutes
        session.sessions_per_week = 1
        session.exact_class_size = requirement.group_size
        session.start_week = min(weeks) if weeks else None
        session.end_week = max(weeks) if weeks else None
        session.week_pattern = requirement.week_pattern or ("Custom" if weeks else "Weekly")
        session.custom_weeks = requirement.custom_weeks
        session.scheduling_type = "Fixed"
        session.fixed_day = requirement.fixed_day
        session.fixed_start_time = requirement.fixed_start_time
        session.fixed_end_time = requirement.fixed_end_time
        session.priority = "Hard"
        session.common_module_flag = False
        session.combined_with_programmes = requirement.programme
        session.hard_constraint_notes = self._lab_notes(requirement)
        session.remarks = self._lab_notes(requirement)
        session.source_file = GENERATED_LAB_SOURCE
        session.source_row_no = requirement.source_row_no
        session.required_room_codes = requirement.required_room_codes
        session.required_student_group_codes = ", ".join(group_codes)
        session.is_lab_requirement = True
        session.lab_requirement_id = requirement.id

    def _replace_staff_assignments(self, db: DbSession, session: Session, staff_members: list[Staff]) -> None:
        db.query(SessionStaff).filter_by(session_id=session.id).delete(synchronize_session=False)
        for index, staff in enumerate(staff_members, start=1):
            db.add(
                SessionStaff(
                    session_id=session.id,
                    staff_id=staff.id,
                    staff_order=index,
                    is_primary=index == 1,
                )
            )

    def _lab_notes(self, requirement: LabRequirement) -> str:
        parts = [f"Built-in lab requirement: {requirement.location}" if requirement.location else "Built-in lab requirement"]
        if requirement.notes:
            parts.append(requirement.notes)
        return " ".join(parts)

    def _split_codes(self, value: str | None) -> list[str]:
        return [part.strip() for part in re.split(r"[,;]+", clean_text(value) or "") if part.strip()]
