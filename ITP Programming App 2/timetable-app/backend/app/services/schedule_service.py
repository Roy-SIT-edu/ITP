"""Schedule orchestration service.

Runs saved-data validation, calls the CP-SAT solver, persists assignments, and
stores post-generation constraint checks for review/export screens.
"""

from __future__ import annotations

from time import perf_counter

from app.models.room import Room
from app.models.schedule_run import ScheduleRun
from app.models.scheduled_session import ScheduledSession
from app.models.session import Session
from app.models.time_slot import TimeSlot
from app.services.constraint_service import ConstraintService
from app.services.lab_overlap_service import LabOverlapService
from app.services.lab_requirement_service import LabRequirementService
from app.services.schedule_quality_service import affected_session_count, schedule_quality_summary
from app.services.soft_constraint_priority_service import SoftConstraintPriorityService
from app.services.validation_service import ValidationService
from app.solver.cp_sat_solver import CpSatTimetableSolver
from sqlalchemy.orm import Session as DbSession

DEFAULT_GENERATION_TIMEOUT_SECONDS = 30.0
REPRODUCIBLE_GENERATION_TIMEOUT_SECONDS = 300.0


def generation_timeout_seconds(reproducible: bool) -> float:
    return REPRODUCIBLE_GENERATION_TIMEOUT_SECONDS if reproducible else DEFAULT_GENERATION_TIMEOUT_SECONDS


class ScheduleService:
    def __init__(self) -> None:
        self.validation_service = ValidationService()
        self.solver = CpSatTimetableSolver()
        self.constraint_service = ConstraintService()
        self.priority_service = SoftConstraintPriorityService()
        self.lab_requirement_service = LabRequirementService()
        self.lab_overlap_service = LabOverlapService()

    def generate(
        self,
        db: DbSession,
        timeout: float | None = None,
        fast_mode: bool = False,
        reproducible: bool = False,
    ) -> dict:
        started_at = perf_counter()
        effective_timeout = timeout if timeout is not None else generation_timeout_seconds(reproducible)
        active_lab_requirement_ids = self.lab_requirement_service.sync_active_to_sessions(db)
        db.commit()

        run = ScheduleRun(status="RUNNING", message="Solver started")
        db.add(run)
        db.commit()
        db.refresh(run)
        run_id = run.id

        sessions = [
            item
            for item in db.query(Session).order_by(Session.id).all()
            if not item.is_lab_requirement or item.requirement_id in active_lab_requirement_ids
        ]
        time_slots = db.query(TimeSlot).order_by(TimeSlot.day, TimeSlot.start_time).all()
        rooms = db.query(Room).order_by(Room.room_code).all()
        soft_weights = self.priority_service.weights(db)

        result = self.solver.solve(
            sessions,
            time_slots,
            rooms,
            soft_constraint_weights=soft_weights,
            max_seconds=effective_timeout,
            fast_mode=fast_mode,
            reproducible=reproducible,
        )
        run = db.query(ScheduleRun).filter_by(id=run_id).one()
        run.solver_status = result["solver_status"]
        run.soft_score = result["soft_score"]
        run.message = result["message"]

        if result["solver_status"] not in {"OPTIMAL", "FEASIBLE"}:
            run.status = "FAILED"
            db.commit()
            return {
                "schedule_run_id": run_id,
                "solver_status": run.solver_status,
                "hard_violation_count": 0,
                "soft_warning_count": 0,
                "soft_score": 0,
                "quality": schedule_quality_summary(
                    scheduled_count=0,
                    hard_issue_count=0,
                    soft_warning_count=0,
                    raw_soft_score=0,
                    affected_session_count=0,
                ),
                "generation_mode": "reproducible" if reproducible else "standard",
                "generation_seconds": round(perf_counter() - started_at, 1),
                "solver_timeout_seconds": effective_timeout,
                "message": run.message,
            }

        for assignment in result["assignments"]:
            db.add(
                ScheduledSession(
                    schedule_run_id=run_id,
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

        lab_overlap_resolution = self.lab_overlap_service.resolve_run(db, run_id)
        check = self.constraint_service.check_and_store(db, run_id, soft_weights)
        run.hard_violation_count = check["hard_violation_count"]
        run.soft_score = int(run.soft_score or 0) + check["weighted_soft_score"]
        run.status = "COMPLETED" if run.hard_violation_count == 0 else "COMPLETED_WITH_CONFLICTS"
        if lab_overlap_resolution["excluded_session_count"]:
            run.message = (
                f"{run.message} Excluded {lab_overlap_resolution['excluded_session_count']} fixed lab session(s) "
                f"from the final timetable to resolve {lab_overlap_resolution['detected_pair_count']} overlap pair(s)."
            )
        db.commit()

        final_scheduled_count = len(result["assignments"]) - lab_overlap_resolution["excluded_session_count"]
        return {
            "schedule_run_id": run_id,
            "solver_status": run.solver_status,
            "hard_violation_count": run.hard_violation_count,
            "soft_warning_count": check["soft_warning_count"],
            "soft_score": run.soft_score,
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
