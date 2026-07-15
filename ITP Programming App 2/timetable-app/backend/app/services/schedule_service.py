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
<<<<<<< Updated upstream
=======
from app.services.lab_overlap_service import LabOverlapService
from app.services.lab_requirement_service import LabRequirementService
from app.services.schedule_quality_service import affected_session_count, schedule_quality_summary
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
=======
        self.lab_requirement_service = LabRequirementService()
        self.lab_overlap_service = LabOverlapService()
>>>>>>> Stashed changes

    def generate(self, db: DbSession) -> dict:
        validation = self.validation_service.validate_latest(db)
        if validation["error_count"] > 0:
            return {
                "error": "VALIDATION_FAILED",
                "message": f"Cannot generate timetable because {validation['error_count']} validation errors exist.",
                "details": validation["errors"],
            }

        sessions = db.query(Session).order_by(Session.id).all()
        time_slots = db.query(TimeSlot).order_by(TimeSlot.day, TimeSlot.start_time).all()
        rooms = db.query(Room).order_by(Room.room_code).all()
        soft_weights = self.priority_service.weights(db)

        run = ScheduleRun(status="RUNNING", message="Solver started")
        db.add(run)
        db.flush()

        result = self.solver.solve(sessions, time_slots, rooms, soft_constraint_weights=soft_weights)
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
<<<<<<< Updated upstream
        check = self.constraint_service.check_and_store(db, run.id, soft_weights)
=======
        lab_overlap_resolution = self.lab_overlap_service.resolve_run(db, run_id)
        check = self.constraint_service.check_and_store(db, run_id, soft_weights)
>>>>>>> Stashed changes
        run.hard_violation_count = check["hard_violation_count"]
        run.soft_score = int(run.soft_score or 0) + check["weighted_soft_score"]
        run.status = "COMPLETED" if run.hard_violation_count == 0 else "COMPLETED_WITH_CONFLICTS"
        if lab_overlap_resolution["excluded_session_count"]:
            run.message = (
                f"{run.message} Excluded {lab_overlap_resolution['excluded_session_count']} fixed lab session(s) "
                f"from the final timetable to resolve {lab_overlap_resolution['detected_pair_count']} overlap pair(s)."
            )
        db.commit()

        final_scheduled_count = sum(
            1 for assignment in result["assignments"] if assignment["session_id"] not in lab_overlap_resolution["excluded_session_ids"]
        )

        return {
            "schedule_run_id": run.id,
            "solver_status": run.solver_status,
            "hard_violation_count": run.hard_violation_count,
            "soft_score": run.soft_score,
<<<<<<< Updated upstream
            "message": run.message,
        }
=======
            "quality": schedule_quality_summary(
                scheduled_count=final_scheduled_count,
                hard_issue_count=run.hard_violation_count,
                soft_warning_count=check["soft_warning_count"],
                raw_soft_score=run.soft_score,
                affected_session_count=affected_session_count(check["violations"]),
            ),
            "generation_mode": "reproducible" if reproducible else "standard",
            "generation_seconds": round(perf_counter() - started_at, 1),
            "solver_timeout_seconds": effective_timeout,
            "lab_overlap_pair_count": lab_overlap_resolution["detected_pair_count"],
            "excluded_lab_session_count": lab_overlap_resolution["excluded_session_count"],
            "excluded_lab_session_ids": lab_overlap_resolution["excluded_session_ids"],
            "message": run.message,
        }

    def auto_deconflict(
        self,
        db: DbSession,
        schedule_run_id: int,
        timeout: float | None = None,
    ) -> dict:
        """Create a safe derived schedule run that preserves source requirements."""

        from app.services.auto_deconflict_service import AutoDeconflictService

        return AutoDeconflictService().run(db, schedule_run_id, timeout=timeout)
>>>>>>> Stashed changes
