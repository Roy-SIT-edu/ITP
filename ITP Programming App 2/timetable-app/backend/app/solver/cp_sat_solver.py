"""CP-SAT solver facade for timetable generation.

This class keeps solver setup small: build candidate variables, run OR-Tools,
and return normalized assignment dictionaries for persistence.
"""

from __future__ import annotations

from ortools.sat.python import cp_model

from app.models.room import Room
from app.models.session import Session
from app.models.time_slot import TimeSlot
from app.solver.model_builder import TimetableModelBuilder
from app.solver.result_parser import ResultParser

SUCCESS_STATUSES = {cp_model.OPTIMAL, cp_model.FEASIBLE}


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
        max_seconds: float = 20.0,
        fast_mode: bool = False,
    ) -> dict:
        if not sessions:
            return {
                "solver_status": "INFEASIBLE",
                "assignments": [],
                "soft_score": 0,
                "message": "No sessions are available to schedule.",
            }

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

        # Keep the review workflow usable for genuinely over-constrained input:
        # if strict room/staff/group clash prevention is impossible, rebuild with
        # heavy clash penalties so the timetable can still be inspected.
        if result["solver_status"] == "INFEASIBLE":
            relaxed = self.model_builder.build(
                sessions,
                time_slots,
                rooms,
                soft_constraint_weights,
                relax_hard_conflicts=True,
            )
            return self._solve_built_model(relaxed, max_seconds, fast_mode)

        return result

    def _solve_built_model(self, built, max_seconds: float, fast_mode: bool) -> dict:
        solver = cp_model.CpSolver()
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
