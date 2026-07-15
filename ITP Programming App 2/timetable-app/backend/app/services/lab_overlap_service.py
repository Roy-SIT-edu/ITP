"""Detect and resolve fixed lab-to-lab resource overlaps for a schedule run.

Lab requirements remain immutable source records. When their fixed placements
overlap, this service retains every scheduled assignment for audit purposes and
marks the smallest deterministic set as excluded from the final timetable.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models.room import Room
from app.models.scheduled_session import ScheduledSession
from app.models.staff import Staff
from app.models.student_group import StudentGroup
from app.services.compatibility import intervals_overlap, session_weeks_conflict
from app.services.scheduling_rules import required_student_group_codes
from ortools.sat.python import cp_model
from sqlalchemy.orm import Session as DbSession


@dataclass(frozen=True)
class LabOverlap:
    left_id: int
    right_id: int
    resource_types: tuple[str, ...]
    room_ids: tuple[int, ...]
    staff_ids: tuple[int, ...]
    group_ids: tuple[int, ...]


class LabOverlapService:
    """Apply and report the minimum final-schedule exclusions for lab overlaps."""

    def resolve_run(self, db: DbSession, schedule_run_id: int) -> dict:
        assignments = self._assignments(db, schedule_run_id)
        overlaps = self.detect(db, assignments)
        excluded_ids = self.minimum_exclusion_ids(overlaps)

        for item in assignments:
            item.included_in_final = not (item.session.is_lab_requirement and item.session_id in excluded_ids)
        db.flush()
        return self.report(db, assignments, overlaps, excluded_ids)

    def report_run(self, db: DbSession, schedule_run_id: int) -> dict:
        assignments = self._assignments(db, schedule_run_id)
        overlaps = self.detect(db, assignments)
        excluded_ids = {item.session_id for item in assignments if item.session.is_lab_requirement and not item.included_in_final}
        return self.report(db, assignments, overlaps, excluded_ids)

    def detect(self, db: DbSession, assignments: list[ScheduledSession]) -> list[LabOverlap]:
        labs = sorted(
            (item for item in assignments if item.session and item.session.is_lab_requirement),
            key=lambda item: (item.session_id, item.id),
        )
        group_ids_by_code = {item.group_code.lower(): item.id for item in db.query(StudentGroup).order_by(StudentGroup.id).all()}
        resource_sets = {
            item.session_id: (
                self._room_ids(item),
                self._staff_ids(item),
                self._group_ids(item, group_ids_by_code),
            )
            for item in labs
        }
        overlaps: list[LabOverlap] = []
        for index, left in enumerate(labs):
            for right in labs[index + 1 :]:
                if not self._placement_overlaps(left, right):
                    continue
                left_rooms, left_staff, left_groups = resource_sets[left.session_id]
                right_rooms, right_staff, right_groups = resource_sets[right.session_id]
                room_ids = tuple(sorted(left_rooms & right_rooms))
                staff_ids = tuple(sorted(left_staff & right_staff))
                group_ids = tuple(sorted(left_groups & right_groups))
                resource_types = tuple(
                    label
                    for label, values in (
                        ("ROOM", room_ids),
                        ("STAFF", staff_ids),
                        ("STUDENT_GROUP", group_ids),
                    )
                    if values
                )
                if resource_types:
                    overlaps.append(
                        LabOverlap(
                            left_id=left.session_id,
                            right_id=right.session_id,
                            resource_types=resource_types,
                            room_ids=room_ids,
                            staff_ids=staff_ids,
                            group_ids=group_ids,
                        )
                    )
        return overlaps

    def minimum_exclusion_ids(self, overlaps: list[LabOverlap]) -> set[int]:
        if not overlaps:
            return set()

        node_ids = sorted({node_id for edge in overlaps for node_id in (edge.left_id, edge.right_id)})
        model = cp_model.CpModel()
        excluded = {node_id: model.new_bool_var(f"exclude_lab_{node_id}") for node_id in node_ids}
        for edge in overlaps:
            model.add(excluded[edge.left_id] + excluded[edge.right_id] >= 1)

        # Cardinality dominates the stable ID-based tie-breaker. A single
        # worker makes the result reproducible even when weighted ties remain.
        tie_break_max = len(node_ids) * (len(node_ids) + 1) // 2
        cardinality_weight = tie_break_max + 1
        model.minimize(
            cardinality_weight * sum(excluded.values()) + sum((index + 1) * excluded[node_id] for index, node_id in enumerate(node_ids))
        )
        solver = cp_model.CpSolver()
        solver.parameters.num_search_workers = 1
        solver.parameters.random_seed = 0
        status = solver.solve(model)
        if status != cp_model.OPTIMAL:
            raise RuntimeError("Unable to compute the minimum lab-overlap exclusion set")
        return {node_id for node_id in node_ids if solver.value(excluded[node_id])}

    def report(
        self,
        db: DbSession,
        assignments: list[ScheduledSession],
        overlaps: list[LabOverlap],
        excluded_ids: set[int],
    ) -> dict:
        by_session_id = {item.session_id: item for item in assignments}
        room_labels = {item.id: item.room_code for item in db.query(Room).all()}
        staff_labels = {item.id: item.staff_name or item.staff_id or str(item.id) for item in db.query(Staff).all()}
        group_labels = {item.id: item.group_code for item in db.query(StudentGroup).all()}
        overlap_rows = []
        for edge in overlaps:
            left = by_session_id[edge.left_id]
            right = by_session_id[edge.right_id]
            pair_exclusions = sorted({edge.left_id, edge.right_id} & excluded_ids)
            overlap_rows.append(
                {
                    "left": self._session_summary(left),
                    "right": self._session_summary(right),
                    "resource_types": list(edge.resource_types),
                    "resources": {
                        "rooms": [room_labels.get(item, str(item)) for item in edge.room_ids],
                        "staff": [staff_labels.get(item, str(item)) for item in edge.staff_ids],
                        "student_groups": [group_labels.get(item, str(item)) for item in edge.group_ids],
                    },
                    "excluded_session_ids": pair_exclusions,
                    "resolved_in_final": bool(pair_exclusions),
                }
            )

        return {
            "detected_pair_count": len(overlap_rows),
            "excluded_session_count": len(excluded_ids),
            "excluded_session_ids": sorted(excluded_ids),
            "excluded_sessions": [
                self._session_summary(by_session_id[session_id]) for session_id in sorted(excluded_ids) if session_id in by_session_id
            ],
            "overlaps": overlap_rows,
        }

    @staticmethod
    def _assignments(db: DbSession, schedule_run_id: int) -> list[ScheduledSession]:
        return (
            db.query(ScheduledSession)
            .filter_by(schedule_run_id=schedule_run_id)
            .order_by(ScheduledSession.session_id, ScheduledSession.id)
            .all()
        )

    @staticmethod
    def _placement_overlaps(left: ScheduledSession, right: ScheduledSession) -> bool:
        return (
            left.day == right.day
            and session_weeks_conflict(left.session, left.time_slot, right.session, right.time_slot)
            and intervals_overlap(left.start_time, left.end_time, right.start_time, right.end_time)
        )

    @staticmethod
    def _room_ids(item: ScheduledSession) -> set[int]:
        return {item.room_id} if item.room_id is not None else set()

    @staticmethod
    def _staff_ids(item: ScheduledSession) -> set[int]:
        ids = {
            assignment.staff_id for assignment in getattr(item.session, "staff_assignments", []) or [] if assignment.staff_id is not None
        }
        if not ids and item.staff_id is not None:
            ids.add(item.staff_id)
        return ids

    @staticmethod
    def _group_ids(item: ScheduledSession, group_ids_by_code: dict[str, int]) -> set[int]:
        ids = {item.session.student_group_id} if item.session.student_group_id is not None else set()
        for code in required_student_group_codes(item.session):
            group_id = group_ids_by_code.get(code.lower())
            if group_id is not None:
                ids.add(group_id)
        return ids

    @staticmethod
    def _session_summary(item: ScheduledSession) -> dict:
        session = item.session
        return {
            "session_id": session.id,
            "scheduled_session_id": item.id,
            "requirement_id": session.requirement_id,
            "lab_requirement_id": session.lab_requirement_id,
            "module_code": session.module.module_code if session.module else None,
            "programme": session.programme.code if session.programme else None,
            "student_group_code": session.student_group.group_code if session.student_group else None,
            "day": item.day,
            "start_time": item.start_time,
            "end_time": item.end_time,
            "week_pattern": item.week_pattern,
            "room": item.room.room_code if item.room else None,
            "included_in_final": bool(item.included_in_final),
        }
