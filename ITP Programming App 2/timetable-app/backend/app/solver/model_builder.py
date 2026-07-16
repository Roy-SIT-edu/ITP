"""Builds the OR-Tools CP-SAT model for timetable assignments.

Each boolean variable means one session is assigned to one compatible
room/time-slot pair. Resource clashes are penalized heavily so a timetable can
still be produced and reviewed when the input contains unavoidable hard issues.
"""

from __future__ import annotations

from dataclasses import dataclass

from ortools.sat.python import cp_model

from app.models.room import Room
from app.models.session import Session
from app.models.time_slot import TimeSlot
from app.services.compatibility import (
    intervals_overlap,
    is_online_mode,
    normalize_token,
    parse_custom_weeks,
    parse_day_list,
    session_weeks_conflict,
    time_to_minutes,
)
from app.services.scheduling_constants import (
    DEFAULT_SOFT_CONSTRAINT_WEIGHTS,
    LONG_CONSECUTIVE_DAY_MINUTES,
    SHORT_CAMPUS_DAY_MAX_MINUTES,
    TUTOR_IDLE_GAP_MINUTES,
)
from app.services.scheduling_rules import (
    candidate_room_allowed,
    candidate_slot_allowed,
    required_student_group_codes,
)

HARD_CONFLICT_PENALTY = 100000
PAIRWISE_SOFT_PENALTY_ASSIGNMENT_LIMIT = 20000
DEFAULT_TERM_WEEKS = 13
TIME_BUCKET_MINUTES = 30


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
        relax_hard_conflicts: bool = False,
    ) -> BuiltModel:
        model = cp_model.CpModel()
        variables: dict[tuple[int, int, int], cp_model.IntVar] = {}
        assignments: list[dict] = []
        soft_penalties = []
        no_candidate_reasons: list[str] = []
        weights = soft_constraint_weights or {}
        group_ids_by_code = {
            group.student_group.group_code.lower(): group.student_group_id
            for group in sessions
            if group.student_group is not None and group.student_group_id is not None
        }

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
                label = session.requirement_id or (session.module.module_code if session.module else f"session {session.id}")
                no_candidate_reasons.append(f"No feasible time slot and room combination is available for {label}.")
                continue

            # Every requirement must be scheduled exactly once.
            model.Add(sum(session_vars) == 1)

        self._add_no_overlap_constraints(
            model,
            assignments,
            lambda item: item["room"].id,
            soft_penalties,
            "ROOM",
            relax_hard_conflicts,
        )
        self._add_staff_no_overlap_constraints(model, assignments, soft_penalties, relax_hard_conflicts)
        self._add_no_overlap_constraints(
            model,
            assignments,
            lambda item: self._group_resource_ids(item["session"], group_ids_by_code),
            soft_penalties,
            "GROUP",
            relax_hard_conflicts,
        )

        for assignment in assignments:
            penalty = self._single_assignment_soft_penalty(assignment, weights)
            if penalty > 0:
                soft_penalties.append(assignment["variable"] * penalty)
        # Pairwise soft preferences can dwarf the hard model on broad imports; final checks still score them after solving.
        if not relax_hard_conflicts and len(assignments) <= PAIRWISE_SOFT_PENALTY_ASSIGNMENT_LIMIT:
            soft_penalties.extend(self._pair_soft_penalties(model, assignments, weights))
        if soft_penalties:
            model.Minimize(sum(soft_penalties))
        return BuiltModel(model, variables, assignments, soft_penalties, no_candidate_reasons)

    def _add_no_overlap_constraints(self, model, assignments, key_func, penalties, code, relax_hard_conflicts) -> None:
        grouped: dict[tuple, list[dict]] = {}
        for item in assignments:
            for bucket in self._resource_time_buckets(item, key_func(item)):
                grouped.setdefault(bucket, []).append(item)

        for items in grouped.values():
            self._add_resource_bucket_rule(
                model,
                items,
                penalties,
                f"{code}_OVERLAP",
                relax_hard_conflicts,
            )

    def _add_staff_no_overlap_constraints(self, model, assignments, penalties, relax_hard_conflicts) -> None:
        grouped: dict[tuple, list[dict]] = {}
        for item in assignments:
            for bucket in self._resource_time_buckets(item, self._session_staff_ids(item["session"])):
                grouped.setdefault(bucket, []).append(item)

        for items in grouped.values():
            self._add_resource_bucket_rule(
                model,
                items,
                penalties,
                "STAFF_OVERLAP",
                relax_hard_conflicts,
            )

    def _add_resource_bucket_rule(self, model, items, penalties, label, relax_hard_conflicts) -> None:
        unique_items = list({id(item["variable"]): item for item in items}.values())
        if len(unique_items) <= 1:
            return
        lab_variables = [item["variable"] for item in unique_items if item["session"].is_lab_requirement]
        non_lab_variables = [item["variable"] for item in unique_items if not item["session"].is_lab_requirement]
        if not non_lab_variables:
            return
        if relax_hard_conflicts:
            self._add_bucket_excess_penalty(model, non_lab_variables, penalties, label)
            for non_lab_variable in non_lab_variables:
                for lab_variable in lab_variables:
                    self._add_pair_excess_penalty(model, non_lab_variable, lab_variable, penalties, label)
        else:
            if len(non_lab_variables) > 1:
                model.Add(sum(non_lab_variables) <= 1)
            for non_lab_variable in non_lab_variables:
                for lab_variable in lab_variables:
                    model.Add(non_lab_variable + lab_variable <= 1)

    def _add_bucket_excess_penalty(self, model, variables, penalties, label) -> None:
        if len(variables) <= 1:
            return
        excess = model.NewIntVar(0, len(variables) - 1, f"hard_{label}_{len(variables)}_{len(penalties)}")
        model.Add(excess >= sum(variables) - 1)
        penalties.append(excess * HARD_CONFLICT_PENALTY)

    def _add_pair_excess_penalty(self, model, left, right, penalties, label) -> None:
        excess = model.NewBoolVar(f"hard_{label}_pair_{len(penalties)}")
        model.Add(excess >= left + right - 1)
        penalties.append(excess * HARD_CONFLICT_PENALTY)

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

    def _group_resource_ids(self, session: Session, group_ids_by_code: dict[str, int]) -> list[int]:
        ids = [session.student_group_id] if session.student_group_id is not None else []
        for code in required_student_group_codes(session):
            group_id = group_ids_by_code.get(code.lower())
            if group_id is not None:
                ids.append(group_id)
        return list(dict.fromkeys(ids))

    def _resource_time_buckets(self, assignment: dict, resources) -> list[tuple]:
        resource_keys = [key for key in self._resource_keys(resources) if key is not None]
        if not resource_keys:
            return []
        slot = assignment["time_slot"]
        day = slot.day
        weeks = self._assignment_week_keys(assignment["session"], slot)
        segments = self._assignment_time_segments(slot)
        return [(resource_key, day, week, segment) for resource_key in resource_keys for week in weeks for segment in segments]

    def _assignment_time_segments(self, slot: TimeSlot) -> list[int]:
        start = time_to_minutes(slot.start_time)
        end = time_to_minutes(slot.end_time)
        if start is None or end is None or end <= start:
            return []
        return list(range(start, end, TIME_BUCKET_MINUTES))

    def _assignment_week_keys(self, session: Session, slot: TimeSlot) -> list[int]:
        weeks = self._active_week_set(session)
        if weeks:
            return sorted(weeks)
        pattern = normalize_token(session.week_pattern or slot.week_pattern or "Weekly")
        if pattern == "custom":
            pattern = normalize_token(slot.week_pattern or "Weekly")
        weeks = range(1, DEFAULT_TERM_WEEKS + 1)
        if pattern == "odd":
            return [week for week in weeks if week % 2 == 1]
        if pattern == "even":
            return [week for week in weeks if week % 2 == 0]
        return list(weeks)

    def _active_week_set(self, session: Session) -> set[int] | None:
        pattern = normalize_token(session.week_pattern or "Weekly")
        if pattern == "custom":
            weeks = set(parse_custom_weeks(session.custom_weeks))
            return weeks or None
        if session.start_week is None or session.end_week is None or session.end_week < session.start_week:
            return None
        weeks = set(range(int(session.start_week), int(session.end_week) + 1))
        if pattern == "odd":
            weeks = {week for week in weeks if week % 2 == 1}
        elif pattern == "even":
            weeks = {week for week in weeks if week % 2 == 0}
        return weeks or None

    def _resource_keys(self, value) -> list[int | None]:
        if isinstance(value, list | tuple | set):
            return list(dict.fromkeys(value))
        return [value]

    def _assignment_pairs(self, assignments: list[dict]):
        for index, left in enumerate(assignments):
            for right in assignments[index + 1 :]:
                if left["session"].id != right["session"].id:
                    yield left, right

    def _soft_weight(self, weights: dict[str, int], code: str) -> int:
        return weights.get(code, DEFAULT_SOFT_CONSTRAINT_WEIGHTS[code])

    def _compatible_pair(self, left: dict, right: dict) -> bool:
        return session_weeks_conflict(left["session"], left["time_slot"], right["session"], right["time_slot"])

    def _assignment_conflicts(self, left: dict, right: dict) -> bool:
        left_slot = left["time_slot"]
        right_slot = right["time_slot"]
        return (
            left_slot.day == right_slot.day
            and intervals_overlap(left_slot.start_time, left_slot.end_time, right_slot.start_time, right_slot.end_time)
            and session_weeks_conflict(left["session"], left_slot, right["session"], right_slot)
        )

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
