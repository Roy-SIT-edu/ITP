"""Builds the OR-Tools CP-SAT model for timetable assignments.

Each boolean variable means one session is assigned to one compatible
room/time-slot pair; constraints then prevent clashes across rooms, staff, and groups.
"""

from __future__ import annotations

from dataclasses import dataclass

from ortools.sat.python import cp_model

from app.models.room import Room
from app.models.session import Session
from app.models.time_slot import TimeSlot
from app.services.compatibility import (
    is_online_mode,
    normalize_token,
    parse_day_list,
    slot_conflicts,
    time_to_minutes,
    weeks_conflict,
)
from app.services.scheduling_constants import (
    DEFAULT_SOFT_CONSTRAINT_WEIGHTS,
    LONG_CONSECUTIVE_DAY_MINUTES,
    SHORT_CAMPUS_DAY_MAX_MINUTES,
    TUTOR_IDLE_GAP_MINUTES,
)
from app.services.scheduling_rules import candidate_room_allowed, candidate_slot_allowed


@dataclass
class BuiltModel:
    model: cp_model.CpModel
    variables: dict[tuple[int, int, int], cp_model.IntVar]
    assignments: list[dict]
    soft_penalties: list[cp_model.LinearExpr]
    no_candidate_reasons: list[str]


class TimetableModelBuilder:
    def build(
        self,
        sessions: list[Session],
        time_slots: list[TimeSlot],
        rooms: list[Room],
        soft_constraint_weights: dict[str, int] | None = None,
    ) -> BuiltModel:
        model = cp_model.CpModel()
        variables: dict[tuple[int, int, int], cp_model.IntVar] = {}
        assignments: list[dict] = []
        no_candidate_reasons: list[str] = []
        weights = soft_constraint_weights or {}

        for session in sessions:
            session_vars = []
            for slot in time_slots:
                if not candidate_slot_allowed(session, slot):
                    continue
                for room in rooms:
                    if not candidate_room_allowed(session, room):
                        continue
                    key = (session.id, slot.id, room.id)
                    # x_session_slot_room is true when the solver chooses this exact assignment.
                    variable = model.NewBoolVar(f"x_{session.id}_{slot.id}_{room.id}")
                    variables[key] = variable
                    assignment = {
                        "session": session,
                        "time_slot": slot,
                        "room": room,
                        "variable": variable,
                    }
                    assignments.append(assignment)
                    session_vars.append(variable)
            if not session_vars:
                dummy_slot = time_slots[0]
                dummy_room = rooms[0]
                variable = model.NewBoolVar(f"x_dummy_{session.id}")
                variables[(session.id, dummy_slot.id, dummy_room.id)] = variable
                assignments.append({
                    "session": session,
                    "time_slot": dummy_slot,
                    "room": dummy_room,
                    "variable": variable,
                })
                session_vars.append(variable)
            
            # Every requirement must be scheduled exactly once.
            model.Add(sum(session_vars) == 1)

        soft_penalties = []
        if not no_candidate_reasons:
            self._add_no_overlap_constraints(model, assignments, lambda item: item["room"].id, soft_penalties, "ROOM")
            self._add_staff_no_overlap_constraints(model, assignments, soft_penalties)
            self._add_no_overlap_constraints(
                model,
                assignments,
                lambda item: item["session"].student_group_id,
                soft_penalties,
                "GROUP"
            )

        for assignment in assignments:
            penalty = self._single_assignment_soft_penalty(assignment, weights)
            if penalty > 0:
                soft_penalties.append(assignment["variable"] * penalty)
        if not no_candidate_reasons:
            soft_penalties.extend(self._pair_soft_penalties(model, assignments, weights))
        if soft_penalties:
            model.Minimize(sum(soft_penalties))
        return BuiltModel(model, variables, assignments, soft_penalties, no_candidate_reasons)

    def _add_no_overlap_constraints(self, model, assignments, key_func, penalties, code) -> None:
        grouped: dict[int, list[dict]] = {}
        for item in assignments:
            key = key_func(item)
            if key is None:
                continue
            grouped.setdefault(key, []).append(item)

        for group in grouped.values():
            for index, left in enumerate(group):
                for right in group[index + 1 :]:
                    if left["session"].id == right["session"].id:
                        continue
                    if slot_conflicts(left["time_slot"], right["time_slot"]):
                        penalties.append(self._both_selected(model, left, right, code) * 100000)

    def _add_staff_no_overlap_constraints(self, model, assignments, penalties) -> None:
        grouped: dict[int, list[dict]] = {}
        for item in assignments:
            for staff_id in self._session_staff_ids(item["session"]):
                grouped.setdefault(staff_id, []).append(item)

        for group in grouped.values():
            for index, left in enumerate(group):
                for right in group[index + 1 :]:
                    if left["session"].id == right["session"].id:
                        continue
                    if slot_conflicts(left["time_slot"], right["time_slot"]):
                        penalties.append(self._both_selected(model, left, right, "STAFF") * 100000)

    def _single_assignment_soft_penalty(self, assignment: dict, weights: dict[str, int]) -> int:
        session = assignment["session"]
        slot = assignment["time_slot"]
        room = assignment["room"]
        penalty = 0
        preferred = parse_day_list(session.preferred_days)
        avoid = parse_day_list(session.avoid_days)
        if preferred and slot.day not in preferred:
            penalty += self._soft_weight(weights, "PREFERRED_DAY_MISMATCH")
        if avoid and normalize_token(session.priority) != "hard" and slot.day in avoid:
            penalty += self._soft_weight(weights, "AVOID_DAY")
        if is_online_mode(session.delivery_mode) and slot.day not in {"Monday", "Tuesday"}:
            penalty += self._soft_weight(weights, "ONLINE_NOT_MON_TUE")
        if not room.is_virtual and (slot.duration_minutes or 0) <= SHORT_CAMPUS_DAY_MAX_MINUTES:
            penalty += self._soft_weight(weights, "SHORT_CAMPUS_DAY")
        return penalty

    def _pair_soft_penalties(
        self,
        model: cp_model.CpModel,
        assignments: list[dict],
        weights: dict[str, int],
    ) -> list[cp_model.LinearExpr]:
        penalties: list[cp_model.LinearExpr] = []
        self._add_tutor_gap_penalties(model, assignments, weights, penalties)
        self._add_student_day_penalties(model, assignments, weights, penalties)
        self._add_online_switch_penalties(model, assignments, weights, penalties)
        return penalties

    def _add_tutor_gap_penalties(
        self,
        model: cp_model.CpModel,
        assignments: list[dict],
        weights: dict[str, int],
        penalties: list[cp_model.LinearExpr],
    ) -> None:
        weight = self._soft_weight(weights, "TUTOR_IDLE_GAP")
        if weight <= 0:
            return
        grouped = self._group_assignments_by_staff_day(assignments)
        for items in grouped.values():
            for left, right in self._assignment_pairs(items):
                if not self._compatible_pair(left, right):
                    continue
                gap = self._gap_minutes(left["time_slot"], right["time_slot"])
                if gap > TUTOR_IDLE_GAP_MINUTES:
                    penalties.append(self._both_selected(model, left, right, "TUTOR_IDLE_GAP") * weight)

    def _add_student_day_penalties(
        self,
        model: cp_model.CpModel,
        assignments: list[dict],
        weights: dict[str, int],
        penalties: list[cp_model.LinearExpr],
    ) -> None:
        long_weight = self._soft_weight(weights, "LONG_CONSECUTIVE_DAY")
        grouped = self._group_assignments(assignments, lambda item: (item["session"].student_group_id, item["time_slot"].day))
        for items in grouped.values():
            for left, right in self._assignment_pairs(items):
                if not self._compatible_pair(left, right):
                    continue
                span = self._span_minutes(left["time_slot"], right["time_slot"])
                if (
                    long_weight > 0
                    and self._gap_minutes(left["time_slot"], right["time_slot"]) == 0
                    and span > LONG_CONSECUTIVE_DAY_MINUTES
                ):
                    penalties.append(self._both_selected(model, left, right, "LONG_CONSECUTIVE_DAY") * long_weight)

    def _add_online_switch_penalties(
        self,
        model: cp_model.CpModel,
        assignments: list[dict],
        weights: dict[str, int],
        penalties: list[cp_model.LinearExpr],
    ) -> None:
        weight = self._soft_weight(weights, "ONLINE_F2F_ADJACENT_SWITCH")
        if weight <= 0:
            return
        groups = [
            ("STAFF", self._group_assignments_by_staff_day(assignments)),
            (
                "GROUP",
                self._group_assignments(assignments, lambda item: (item["session"].student_group_id, item["time_slot"].day)),
            ),
        ]
        for scope, grouped in groups:
            for items in grouped.values():
                for left, right in self._assignment_pairs(items):
                    if not self._compatible_pair(left, right):
                        continue
                    if self._gap_minutes(left["time_slot"], right["time_slot"]) != 0:
                        continue
                    left_online = left["room"].is_virtual or is_online_mode(left["session"].delivery_mode)
                    right_online = right["room"].is_virtual or is_online_mode(right["session"].delivery_mode)
                    if left_online != right_online:
                        penalties.append(self._both_selected(model, left, right, f"ONLINE_F2F_ADJACENT_SWITCH_{scope}") * weight)

    def _group_assignments(self, assignments: list[dict], key_func) -> dict[tuple[int, str], list[dict]]:
        grouped: dict[tuple[int, str], list[dict]] = {}
        for item in assignments:
            key = key_func(item)
            if key[0] is None:
                continue
            grouped.setdefault(key, []).append(item)
        return grouped

    def _group_assignments_by_staff_day(self, assignments: list[dict]) -> dict[tuple[int, str], list[dict]]:
        grouped: dict[tuple[int, str], list[dict]] = {}
        for item in assignments:
            for staff_id in self._session_staff_ids(item["session"]):
                grouped.setdefault((staff_id, item["time_slot"].day), []).append(item)
        return grouped

    def _session_staff_ids(self, session: Session) -> list[int]:
        ids = [assignment.staff_id for assignment in getattr(session, "staff_assignments", []) or [] if assignment.staff_id is not None]
        if not ids and session.staff_id is not None:
            ids.append(session.staff_id)
        return ids

    def _assignment_pairs(self, assignments: list[dict]):
        for index, left in enumerate(assignments):
            for right in assignments[index + 1 :]:
                if left["session"].id != right["session"].id:
                    yield left, right

    def _soft_weight(self, weights: dict[str, int], code: str) -> int:
        return weights.get(code, DEFAULT_SOFT_CONSTRAINT_WEIGHTS[code])

    def _compatible_pair(self, left: dict, right: dict) -> bool:
        return weeks_conflict(left["time_slot"].week_pattern, right["time_slot"].week_pattern)

    def _both_selected(self, model: cp_model.CpModel, left: dict, right: dict, code: str):
        left_key = f"{left['session'].id}_{left['time_slot'].id}_{left['room'].id}"
        right_key = f"{right['session'].id}_{right['time_slot'].id}_{right['room'].id}"
        selected = model.NewBoolVar(f"soft_{code}_{left_key}_{right_key}")
        model.AddBoolAnd([left["variable"], right["variable"]]).OnlyEnforceIf(selected)
        model.AddBoolOr([left["variable"].Not(), right["variable"].Not()]).OnlyEnforceIf(selected.Not())
        return selected

    def _gap_minutes(self, left: TimeSlot, right: TimeSlot) -> int:
        left_start = time_to_minutes(left.start_time) or 0
        left_end = time_to_minutes(left.end_time) or 0
        right_start = time_to_minutes(right.start_time) or 0
        right_end = time_to_minutes(right.end_time) or 0
        if left_end <= right_start:
            return right_start - left_end
        if right_end <= left_start:
            return left_start - right_end
        return 0

    def _span_minutes(self, left: TimeSlot, right: TimeSlot) -> int:
        starts = [time_to_minutes(left.start_time) or 0, time_to_minutes(right.start_time) or 0]
        ends = [time_to_minutes(left.end_time) or 0, time_to_minutes(right.end_time) or 0]
        return max(ends) - min(starts)
