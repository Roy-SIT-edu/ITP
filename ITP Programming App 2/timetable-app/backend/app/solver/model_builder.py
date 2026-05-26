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
    delivery_room_compatible,
    normalize_token,
    parse_custom_weeks,
    parse_day_list,
    room_capacity_fits,
    slot_conflicts,
    venue_room_compatible,
)


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
    ) -> BuiltModel:
        model = cp_model.CpModel()
        variables: dict[tuple[int, int, int], cp_model.IntVar] = {}
        assignments: list[dict] = []
        no_candidate_reasons: list[str] = []

        for session in sessions:
            session_vars = []
            for slot in time_slots:
                if not self._slot_allowed(session, slot):
                    continue
                for room in rooms:
                    if not self._room_allowed(session, room):
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
                label = session.requirement_id or f"session {session.id}"
                no_candidate_reasons.append(f"{label} has no compatible room/time-slot candidates")
            else:
                # Every requirement must be scheduled exactly once.
                model.Add(sum(session_vars) == 1)

        if not no_candidate_reasons:
            self._add_no_overlap_constraints(model, assignments, lambda item: item["room"].id)
            self._add_no_overlap_constraints(
                model,
                assignments,
                lambda item: item["session"].staff_id,
            )
            self._add_no_overlap_constraints(
                model,
                assignments,
                lambda item: item["session"].student_group_id,
            )

        soft_penalties = [
            assignment["variable"] * self._soft_penalty(assignment["session"], assignment["time_slot"])
            for assignment in assignments
            if self._soft_penalty(assignment["session"], assignment["time_slot"]) > 0
        ]
        if soft_penalties:
            model.Minimize(sum(soft_penalties))
        return BuiltModel(model, variables, assignments, soft_penalties, no_candidate_reasons)

    def _slot_allowed(self, session: Session, slot: TimeSlot) -> bool:
        if session.duration_minutes and slot.duration_minutes != session.duration_minutes:
            return False
        session_week = normalize_token(session.week_pattern or "Weekly")
        slot_week = normalize_token(slot.week_pattern)
        if session_week == "custom":
            custom_weeks = parse_custom_weeks(session.custom_weeks)
            if custom_weeks:
                has_odd = any(week % 2 == 1 for week in custom_weeks)
                has_even = any(week % 2 == 0 for week in custom_weeks)
                if has_odd and not has_even and slot_week != "odd":
                    return False
                if has_even and not has_odd and slot_week != "even":
                    return False
                if has_odd and has_even and slot_week != "weekly":
                    return False
        elif session_week in {"weekly", "odd", "even"} and session_week != slot_week:
            return False
        if normalize_token(session.scheduling_type) == "fixed":
            if session.fixed_day and slot.day != session.fixed_day:
                return False
            if session.fixed_start_time and slot.start_time != session.fixed_start_time:
                return False
            if session.fixed_end_time and slot.end_time != session.fixed_end_time:
                return False
        if normalize_token(session.priority) == "hard" and slot.day in parse_day_list(session.avoid_days):
            return False
        return True

    def _room_allowed(self, session: Session, room: Room) -> bool:
        return (
            room_capacity_fits(session, room)
            and delivery_room_compatible(session, room)
            and venue_room_compatible(session, room)
        )

    def _add_no_overlap_constraints(self, model, assignments, key_func) -> None:
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
                        model.Add(left["variable"] + right["variable"] <= 1)

    def _soft_penalty(self, session: Session, slot: TimeSlot) -> int:
        penalty = 0
        preferred = parse_day_list(session.preferred_days)
        avoid = parse_day_list(session.avoid_days)
        if preferred and slot.day not in preferred:
            penalty += 3
        if avoid and normalize_token(session.priority) != "hard" and slot.day in avoid:
            penalty += 6
        if normalize_token(session.delivery_mode) == "online" and slot.day not in {"Monday", "Tuesday"}:
            penalty += 1
        return penalty
