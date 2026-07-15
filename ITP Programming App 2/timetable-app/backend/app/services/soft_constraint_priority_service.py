"""Soft-constraint priority configuration for solver scoring."""

from __future__ import annotations

from app.models.soft_constraint_priority import SoftConstraintPriority
from sqlalchemy.orm import Session as DbSession

SOFT_CONSTRAINT_DEFINITIONS = [
    {
        "constraint_code": "AVOID_DAY",
        "label": "Avoid blocked days",
        "description": "Penalizes flexible sessions that land on a row's Avoid Days.",
        "default_rank": 1,
    },
    {
        "constraint_code": "PREFERRED_DAY_MISMATCH",
        "label": "Respect preferred days",
        "description": "Penalizes flexible sessions that miss a row's Preferred Days.",
        "default_rank": 2,
    },
    {
        "constraint_code": "TUTOR_IDLE_GAP",
        "label": "Reduce tutor idle gaps",
        "description": "Penalizes long gaps between a tutor's sessions on the same day.",
        "default_rank": 3,
    },
    {
        "constraint_code": "LONG_CONSECUTIVE_DAY",
        "label": "Avoid long consecutive blocks",
        "description": "Penalizes student groups with long back-to-back teaching blocks.",
        "default_rank": 4,
    },
    {
        "constraint_code": "ONLINE_F2F_ADJACENT_SWITCH",
        "label": "Avoid online/F2F switches",
        "description": "Penalizes adjacent online and face-to-face sessions with no travel gap.",
        "default_rank": 5,
    },
    {
        "constraint_code": "SHORT_CAMPUS_DAY",
        "label": "Avoid short campus days",
        "description": "Penalizes short physical-only campus visits.",
        "default_rank": 6,
    },
    {
        "constraint_code": "ONLINE_NOT_MON_TUE",
        "label": "Prefer online on Mon/Tue",
        "description": "Penalizes online sessions outside Monday and Tuesday.",
        "default_rank": 7,
    },
]


class SoftConstraintPriorityService:
    def list_priorities(self, db: DbSession) -> list[dict]:
        self._ensure_defaults(db)
        rows = {item.constraint_code: item for item in db.query(SoftConstraintPriority).order_by(SoftConstraintPriority.rank).all()}
<<<<<<< Updated upstream
        priorities = [
            {
                **definition,
                "rank": rows[definition["constraint_code"]].rank,
                "weight": rows[definition["constraint_code"]].weight,
            }
            for definition in SOFT_CONSTRAINT_DEFINITIONS
        ]
        return sorted(priorities, key=lambda item: item["rank"])
=======
        priorities = []
        for definition in SOFT_CONSTRAINT_DEFINITIONS:
            row = rows[definition["constraint_code"]]
            is_active = bool(row.is_active)
            priorities.append(
                {
                    **definition,
                    "rank": row.rank if is_active else 0,
                    "weight": row.weight if is_active else 0,
                    "is_active": is_active,
                    "_sort_rank": row.rank,
                }
            )
        sorted_priorities = sorted(
            priorities,
            key=lambda item: (not item["is_active"], item["_sort_rank"], item["default_rank"]),
        )
        for item in sorted_priorities:
            item.pop("_sort_rank", None)
        return sorted_priorities
>>>>>>> Stashed changes

    def update_priorities(self, db: DbSession, ordered_codes: list[str]) -> list[dict]:
        known_codes = [definition["constraint_code"] for definition in SOFT_CONSTRAINT_DEFINITIONS]
        cleaned: list[str] = []
        for code in ordered_codes:
            if code not in known_codes:
                raise ValueError(f"Unknown soft constraint: {code}")
            if code not in cleaned:
                cleaned.append(code)
        cleaned.extend(code for code in known_codes if code not in cleaned)

        self._ensure_defaults(db)
        rows = {
            item.constraint_code: item
            for item in db.query(SoftConstraintPriority).filter(SoftConstraintPriority.constraint_code.in_(known_codes)).all()
        }
        total = len(known_codes)
        for rank, code in enumerate(cleaned, start=1):
            row = rows[code]
            row.rank = rank
            row.weight = self.weight_for_rank(rank, total)
        db.commit()
        return self.list_priorities(db)

    def weights(self, db: DbSession) -> dict[str, int]:
<<<<<<< Updated upstream
        return {item["constraint_code"]: item["weight"] for item in self.list_priorities(db)}
=======
        return {item["constraint_code"]: item["weight"] if item["is_active"] else 0 for item in self.list_priorities(db)}
>>>>>>> Stashed changes

    @staticmethod
    def weight_for_rank(rank: int, total: int) -> int:
        return max(1, total - rank + 1) * 5

    def _ensure_defaults(self, db: DbSession) -> None:
        existing = {item.constraint_code: item for item in db.query(SoftConstraintPriority).all()}
        total = len(SOFT_CONSTRAINT_DEFINITIONS)
        changed = False
        for definition in SOFT_CONSTRAINT_DEFINITIONS:
            code = definition["constraint_code"]
            if code in existing:
                continue
            rank = int(definition["default_rank"])
            db.add(
                SoftConstraintPriority(
                    constraint_code=code,
                    rank=rank,
                    weight=self.weight_for_rank(rank, total),
                )
            )
            changed = True
        if changed:
            db.commit()
