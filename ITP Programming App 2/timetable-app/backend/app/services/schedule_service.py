"""Schedule orchestration service.

Runs saved-data validation, calls the CP-SAT solver, persists assignments, and
stores post-generation constraint checks for review/export screens.
"""

from __future__ import annotations

from app.models.room import Room
from app.models.schedule_run import ScheduleRun
from app.models.scheduled_session import ScheduledSession
from app.models.session import Session
from app.models.time_slot import TimeSlot
from app.services.constraint_service import ConstraintService
from app.services.soft_constraint_priority_service import SoftConstraintPriorityService
from app.services.validation_service import ValidationService
from app.solver.cp_sat_solver import CpSatTimetableSolver
from sqlalchemy.orm import Session as DbSession


class ScheduleService:
    def __init__(self) -> None:
        self.validation_service = ValidationService()
        self.solver = CpSatTimetableSolver()
        self.constraint_service = ConstraintService()
        self.priority_service = SoftConstraintPriorityService()

    def generate(self, db: DbSession, timeout: float = 0.0, fast_mode: bool = False) -> dict:
        sessions = db.query(Session).order_by(Session.id).all()
        time_slots = db.query(TimeSlot).order_by(TimeSlot.day, TimeSlot.start_time).all()
        rooms = db.query(Room).order_by(Room.room_code).all()
        soft_weights = self.priority_service.weights(db)

        run = ScheduleRun(status="RUNNING", message="Solver started")
        db.add(run)
        db.flush()

        result = self.solver.solve(sessions, time_slots, rooms, soft_constraint_weights=soft_weights, max_seconds=timeout, fast_mode=fast_mode)
        run.solver_status = result["solver_status"]
        run.soft_score = result["soft_score"]
        run.message = result["message"]

        if result["solver_status"] not in {"OPTIMAL", "FEASIBLE"}:
            run.status = "FAILED"
            run.message = result["message"]
            db.commit()
            return {
                "schedule_run_id": run.id,
                "solver_status": run.solver_status,
                "hard_violation_count": 0,
                "soft_score": 0,
                "message": run.message,
            }

        for assignment in result["assignments"]:
            db.add(
                ScheduledSession(
                    schedule_run_id=run.id,
                    session_id=assignment["session_id"],
                    room_id=assignment["room_id"],
                    time_slot_id=assignment["time_slot_id"],
                    staff_id=assignment["staff_id"],
                    day=assignment["day"],
                    start_time=assignment["start_time"],
                    end_time=assignment["end_time"],
                    week_pattern=assignment["week_pattern"],
                )
            )
        db.flush()
        check = self.constraint_service.check_and_store(db, run.id, soft_weights)
        run.hard_violation_count = check["hard_violation_count"]
        run.soft_score = int(run.soft_score or 0) + check["weighted_soft_score"]
        run.status = "COMPLETED" if run.hard_violation_count == 0 else "COMPLETED_WITH_CONFLICTS"
        db.commit()

        return {
            "schedule_run_id": run.id,
            "solver_status": run.solver_status,
            "hard_violation_count": run.hard_violation_count,
            "soft_score": run.soft_score,
            "message": run.message,
        }
