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

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = max_seconds
        if fast_mode:
            solver.parameters.stop_after_first_solution = True
        # Multiple workers usually improves feasibility search on timetable grids.
        solver.parameters.num_search_workers = 8
        status = solver.Solve(built.model)
        status_name = solver.StatusName(status)

        if status not in {cp_model.OPTIMAL, cp_model.FEASIBLE}:
            return {
                "solver_status": status_name,
                "assignments": [],
                "soft_score": 0,
                "message": "No feasible timetable found. Check room capacity, staff clashes, fixed sessions, and unavailable slots.",
            }

        return {
            "solver_status": status_name,
            "assignments": self.result_parser.parse(solver, built.assignments),
            "soft_score": int(solver.ObjectiveValue()) if built.soft_penalties else 0,
            "message": "Schedule generated successfully",
        }
