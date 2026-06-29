"""Helpers for maintaining programme/year student-group partitions."""

from __future__ import annotations

import re

from app.models.programme import Programme
from app.models.session import Session as RequirementSession
from app.models.student_group import StudentGroup
from sqlalchemy import func
from sqlalchemy.orm import Session as DbSession

DEFAULT_STUDENT_GROUPS_PER_YEAR = 2
DEFAULT_STUDENT_GROUP_SIZE = 40


def student_group_code(programme_code: str, year: int, partition: int = 1) -> str:
    return f"{programme_code.strip().upper()} Y{year} P{partition}"


def student_group_partition(group_code: str | None) -> int | None:
    if not group_code:
        return None
    match = re.search(r"\bP\s*(\d+)\s*$", group_code.strip(), re.IGNORECASE)
    return int(match.group(1)) if match else None


def next_student_group_partition(db: DbSession, programme_id: int, year: int) -> int:
    partitions = [
        partition
        for partition in (
            student_group_partition(item.group_code)
            for item in db.query(StudentGroup).filter_by(programme_id=programme_id, year=year).all()
        )
        if partition is not None
    ]
    return (max(partitions) + 1) if partitions else 1


def ensure_programme_year_groups(
    db: DbSession,
    programme: Programme | None = None,
    groups_per_year: int = DEFAULT_STUDENT_GROUPS_PER_YEAR,
    default_size: int = DEFAULT_STUDENT_GROUP_SIZE,
) -> int:
    """Ensure each programme year has default partition groups.

    Existing rows are left alone so admin edits are preserved. Missing generated
    rows are added as P1/P2 by default, which still lets admins append P3, P4,
    and so on from the Student Groups database page.
    """

    created = 0
    programme_rows = [programme] if programme else db.query(Programme).order_by(Programme.code).all()
    partition_count = max(1, int(groups_per_year or 1))

    for item in programme_rows:
        if not item or not item.code:
            continue
        year_count = max(1, int(item.years or 1))
        for year in range(1, year_count + 1):
            for partition in range(1, partition_count + 1):
                code = student_group_code(item.code, year, partition)
                existing = db.query(StudentGroup).filter(func.lower(StudentGroup.group_code) == code.lower()).first()
                if existing:
                    if existing.programme_id is None:
                        existing.programme_id = item.id
                    if existing.year is None:
                        existing.year = year
                    if existing.size is None:
                        existing.size = default_size
                    continue
                db.add(
                    StudentGroup(
                        group_code=code,
                        programme_id=item.id,
                        year=year,
                        size=default_size,
                    )
                )
                created += 1

    if created:
        db.flush()
    return created


def normalize_student_group_ids(db: DbSession) -> dict[int, int]:
    """Compact student-group IDs to 1..N and remap requirement references."""

    groups = db.query(StudentGroup).order_by(StudentGroup.group_code).all()
    expected_ids = list(range(1, len(groups) + 1))
    current_ids = [group.id for group in groups]
    if current_ids == expected_ids:
        return {}

    rows = [
        {
            "old_id": group.id,
            "new_id": index,
            "group_code": group.group_code,
            "programme_id": group.programme_id,
            "year": group.year,
            "size": group.size,
        }
        for index, group in enumerate(groups, start=1)
    ]
    id_map = {row["old_id"]: row["new_id"] for row in rows}

    for requirement in db.query(RequirementSession).filter(RequirementSession.student_group_id.in_(id_map)).all():
        requirement.student_group_id = id_map[requirement.student_group_id]
    db.flush()

    db.query(StudentGroup).delete(synchronize_session=False)
    db.flush()
    for group in groups:
        if group in db:
            db.expunge(group)

    for row in rows:
        db.add(
            StudentGroup(
                id=row["new_id"],
                group_code=row["group_code"],
                programme_id=row["programme_id"],
                year=row["year"],
                size=row["size"],
            )
        )
    db.flush()
    return id_map
