"""CP-SAT solver facade for timetable generation.

This class keeps solver setup small: build candidate variables, run OR-Tools,
and return normalized assignment dictionaries for persistence.
"""

from __future__ import annotations

from ortools.sat.python import cp_model

from app.models.room import Room
from app.models.session import Session
from app.models.time_slot import TimeSlot
from app.services.compatibility import (
    is_online_mode,
    normalize_token,
    parse_custom_weeks,
    parse_day_list,
    time_to_minutes,
)
from app.services.scheduling_constants import (
    DEFAULT_SOFT_CONSTRAINT_WEIGHTS,
    SHORT_CAMPUS_DAY_MAX_MINUTES,
)
from app.services.scheduling_rules import (
    candidate_room_allowed,
    candidate_slot_allowed,
    fixed_sessions_conflict,
    required_room_codes,
    required_student_group_codes,
)
from app.solver.model_builder import TimetableModelBuilder
from app.solver.result_parser import ResultParser

SUCCESS_STATUSES = {cp_model.OPTIMAL, cp_model.FEASIBLE}
DEFAULT_TERM_WEEKS = 13
TIME_BUCKET_MINUTES = 30
GREEDY_CONFLICT_PENALTY = 100000


class CpSatTimetableSolver:
    def __init__(self) -> None:
        self.model_builder = TimetableModelBuilder()
        self.result_parser = ResultParser()

    def solve(
        self,
        sessions: list[Session],
        time_slots: list[TimeSlot],
        rooms: list[Room],
        soft_constraint_weights: dict[str, int] | None = None,
        max_seconds: float = 0.0,
        fast_mode: bool = False,
    ) -> dict:
        if not sessions:
            return {
                "solver_status": "INFEASIBLE",
                "assignments": [],
                "soft_score": 0,
                "message": "No sessions are available to schedule.",
            }

        if self._has_known_fixed_hard_clash(sessions):
            return self._greedy_fallback(
                sessions,
                time_slots,
                rooms,
                soft_constraint_weights,
                "Fixed hard clashes are present; generated a reviewable timetable with conflict checks.",
            )

        built = self.model_builder.build(sessions, time_slots, rooms, soft_constraint_weights)
        if built.no_candidate_reasons:
            return {
                "solver_status": "INFEASIBLE",
                "assignments": [],
                "soft_score": 0,
                "message": " ".join(built.no_candidate_reasons),
            }

        result = self._solve_built_model(built, max_seconds, fast_mode)
        if result["solver_status"] in {"OPTIMAL", "FEASIBLE"}:
            return result

        # Keep the review workflow usable for genuinely over-constrained input or timeouts:
        # if strict room/staff/group clash prevention is impossible or takes too long, rebuild with
        # heavy clash penalties so the timetable can still be inspected.
        if result["solver_status"] == "UNKNOWN":
            return self._greedy_fallback(
                sessions,
                time_slots,
                rooms,
                soft_constraint_weights,
                "Solver timed out; generated a reviewable timetable with conflict checks.",
            )

        if result["solver_status"] == "INFEASIBLE":
            relaxed = self.model_builder.build(
                sessions,
                time_slots,
                rooms,
                soft_constraint_weights,
                relax_hard_conflicts=True,
            )
            relaxed_result = self._solve_built_model(relaxed, max_seconds, fast_mode=True)
            if relaxed_result["solver_status"] in {"OPTIMAL", "FEASIBLE"}:
                return relaxed_result
            return self._greedy_fallback(
                sessions,
                time_slots,
                rooms,
                soft_constraint_weights,
                "Solver timed out; generated a reviewable timetable with conflict checks.",
            )

        return result

    def _solve_built_model(self, built, max_seconds: float, fast_mode: bool) -> dict:
        solver = cp_model.CpSolver()
        if max_seconds > 0:
            solver.parameters.max_time_in_seconds = max_seconds
        if fast_mode:
            solver.parameters.stop_after_first_solution = True
        # Multiple workers usually improves feasibility search on timetable grids.
        solver.parameters.num_search_workers = 8
        status = solver.Solve(built.model)
        status_name = solver.StatusName(status)

        if status not in SUCCESS_STATUSES:
            message = (
                "Solver timed out before finding a timetable. Try again or reduce flexible room/time choices."
                if status_name == "UNKNOWN"
                else "No feasible timetable found. Check room capacity, staff clashes, fixed sessions, and unavailable slots."
            )
            return {
                "solver_status": status_name,
                "assignments": [],
                "soft_score": 0,
                "message": message,
            }

        return {
            "solver_status": status_name,
            "assignments": self.result_parser.parse(solver, built.assignments),
            "soft_score": int(solver.ObjectiveValue()) if built.soft_penalties else 0,
            "message": "Schedule generated successfully",
        }

    def _greedy_fallback(
        self,
        sessions: list[Session],
        time_slots: list[TimeSlot],
        rooms: list[Room],
        soft_constraint_weights: dict[str, int] | None,
        message: str,
    ) -> dict:
        weights = soft_constraint_weights or {}
        group_ids_by_code = {
            session.student_group.group_code.lower(): session.student_group_id
            for session in sessions
            if session.student_group is not None and session.student_group_id is not None
        }
        candidate_map = {session.id: self._session_candidates(session, time_slots, rooms) for session in sessions}
        if any(not candidates for candidates in candidate_map.values()):
            missing = [
                session.requirement_id or (session.module.module_code if session.module else f"session {session.id}")
                for session in sessions
                if not candidate_map[session.id]
            ]
            return {
                "solver_status": "INFEASIBLE",
                "assignments": [],
                "soft_score": 0,
                "message": "No feasible time slot and room combination is available for " + ", ".join(missing[:5]) + ".",
            }

        occupied = {"room": set(), "staff": set(), "group": set()}
        selected = []
        ordered_sessions = sorted(
            sessions,
            key=lambda session: (
                0 if session.is_lab_requirement or normalize_token(session.scheduling_type) == "fixed" else 1,
                len(candidate_map[session.id]),
                session.id,
            ),
        )
        for session in ordered_sessions:
            best = min(
                candidate_map[session.id],
                key=lambda candidate: self._candidate_score(candidate, occupied, group_ids_by_code, weights),
            )
            self._reserve_candidate(best, occupied, group_ids_by_code)
            selected.append(best)

        return {
            "solver_status": "FEASIBLE",
            "assignments": [self._assignment_dict(item) for item in selected],
            "soft_score": 0,
            "message": message,
        }

    def _has_known_fixed_hard_clash(self, sessions: list[Session]) -> bool:
        fixed = [
            session
            for session in sessions
            if normalize_token(session.scheduling_type) == "fixed"
            and session.fixed_day
            and session.fixed_start_time
            and session.fixed_end_time
        ]
        for index, left in enumerate(fixed):
            for right in fixed[index + 1 :]:
                if left.is_lab_requirement and right.is_lab_requirement:
                    continue
                if not fixed_sessions_conflict(left, right):
                    continue
                if set(self._session_staff_ids(left)) & set(self._session_staff_ids(right)):
                    return True
                if self._group_keys(left) & self._group_keys(right):
                    return True
                if self._single_required_room_key(left) and self._single_required_room_key(left) == self._single_required_room_key(right):
                    return True
        return False

    def _group_keys(self, session: Session) -> set[str]:
        keys = set()
        if session.student_group_id is not None:
            keys.add(f"id:{session.student_group_id}")
        if session.student_group and session.student_group.group_code:
            keys.add(f"code:{session.student_group.group_code.lower()}")
        for code in required_student_group_codes(session):
            keys.add(f"code:{code.lower()}")
        return keys

    def _single_required_room_key(self, session: Session) -> str | None:
        codes = required_room_codes(session)
        if len(codes) == 1:
            return codes[0].lower()
        return None

    def _session_candidates(self, session: Session, time_slots: list[TimeSlot], rooms: list[Room]) -> list[dict]:
        return [
            {"session": session, "time_slot": slot, "room": room}
            for slot in time_slots
            if candidate_slot_allowed(session, slot)
            for room in rooms
            if candidate_room_allowed(session, room)
        ]

    def _candidate_score(self, candidate: dict, occupied: dict[str, set], group_ids_by_code: dict[str, int], weights: dict[str, int]) -> int:
        score = self._single_candidate_soft_penalty(candidate, weights)
        score += self._bucket_conflict_count(self._room_buckets(candidate), occupied["room"]) * GREEDY_CONFLICT_PENALTY
        score += self._bucket_conflict_count(self._staff_buckets(candidate), occupied["staff"]) * GREEDY_CONFLICT_PENALTY
        score += (
            self._bucket_conflict_count(self._group_buckets(candidate, group_ids_by_code), occupied["group"])
            * GREEDY_CONFLICT_PENALTY
        )
        room = candidate["room"]
        session = candidate["session"]
        if session.exact_class_size and room.capacity:
            score += max(int(room.capacity) - int(session.exact_class_size), 0)
        return score

    def _reserve_candidate(self, candidate: dict, occupied: dict[str, set], group_ids_by_code: dict[str, int]) -> None:
        occupied["room"].update(self._room_buckets(candidate))
        occupied["staff"].update(self._staff_buckets(candidate))
        occupied["group"].update(self._group_buckets(candidate, group_ids_by_code))

    def _bucket_conflict_count(self, buckets: list[tuple], occupied: set[tuple]) -> int:
        return sum(1 for bucket in buckets if bucket in occupied)

    def _room_buckets(self, candidate: dict) -> list[tuple]:
        return self._resource_time_buckets(candidate, [candidate["room"].id])

    def _staff_buckets(self, candidate: dict) -> list[tuple]:
        return self._resource_time_buckets(candidate, self._session_staff_ids(candidate["session"]))

    def _group_buckets(self, candidate: dict, group_ids_by_code: dict[str, int]) -> list[tuple]:
        return self._resource_time_buckets(candidate, self._group_resource_ids(candidate["session"], group_ids_by_code))

    def _resource_time_buckets(self, candidate: dict, resource_ids: list[int | None]) -> list[tuple]:
        slot = candidate["time_slot"]
        weeks = self._assignment_week_keys(candidate["session"], slot)
        segments = self._assignment_time_segments(slot)
        return [
            (resource_id, slot.day, week, segment)
            for resource_id in resource_ids
            if resource_id is not None
            for week in weeks
            for segment in segments
        ]

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

    def _single_candidate_soft_penalty(self, candidate: dict, weights: dict[str, int]) -> int:
        session = candidate["session"]
        slot = candidate["time_slot"]
        room = candidate["room"]
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

    def _soft_weight(self, weights: dict[str, int], code: str) -> int:
        return weights.get(code, DEFAULT_SOFT_CONSTRAINT_WEIGHTS[code])

    def _assignment_dict(self, candidate: dict) -> dict:
        session = candidate["session"]
        slot = candidate["time_slot"]
        room = candidate["room"]
        return {
            "session_id": session.id,
            "room_id": room.id,
            "time_slot_id": slot.id,
            "staff_id": session.staff_id,
            "day": slot.day,
            "start_time": slot.start_time,
            "end_time": slot.end_time,
            "week_pattern": slot.week_pattern,
        }
