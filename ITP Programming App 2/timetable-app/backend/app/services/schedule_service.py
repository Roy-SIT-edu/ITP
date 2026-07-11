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
            run.message = result["message"]
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
        check = self.constraint_service.check_and_store(db, run_id, soft_weights)
        run.hard_violation_count = check["hard_violation_count"]
        run.soft_score = int(run.soft_score or 0) + check["weighted_soft_score"]
        run.status = "COMPLETED" if run.hard_violation_count == 0 else "COMPLETED_WITH_CONFLICTS"
        db.commit()

        return {
            "schedule_run_id": run_id,
            "solver_status": run.solver_status,
            "hard_violation_count": run.hard_violation_count,
            "soft_warning_count": check["soft_warning_count"],
            "soft_score": run.soft_score,
            "quality": schedule_quality_summary(
                scheduled_count=len(result["assignments"]),
                hard_issue_count=run.hard_violation_count,
                soft_warning_count=check["soft_warning_count"],
                raw_soft_score=run.soft_score,
                affected_session_count=affected_session_count(check["violations"]),
            ),
            "generation_mode": "reproducible" if reproducible else "standard",
            "generation_seconds": round(perf_counter() - started_at, 1),
            "solver_timeout_seconds": effective_timeout,
            "message": run.message,
        }

    def auto_deconflict(
        self,
        db: DbSession,
        schedule_run_id: int,
        timeout: float | None = None,
        reproducible: bool = False,
    ) -> dict:
        """Targeted greedy deconflict: find hard conflicts, move clashing sessions to clean slots."""
        from app.services.compatibility import (
            intervals_overlap,
            normalize_token,
            session_weeks_conflict,
            time_to_minutes,
            parse_day_list,
        )
        from app.services.scheduling_rules import (
            candidate_room_allowed,
            required_student_group_codes,
        )
        from app.models.student_group import StudentGroup

        started_at = perf_counter()

        run_record = db.query(ScheduleRun).filter_by(id=schedule_run_id).first()
        if not run_record:
            raise ValueError("Schedule run not found")

        # Sync lab requirements
        self.lab_requirement_service.sync_active_to_sessions(db)
        db.commit()

        # Create a new run as a copy of the current one
        run = ScheduleRun(status="RUNNING", message="Auto-deconflict started")
        db.add(run)
        db.commit()
        db.refresh(run)
        new_run_id = run.id

        # Copy all current assignments to the new run
        current_assignments = db.query(ScheduledSession).filter_by(schedule_run_id=schedule_run_id).all()
        for ca in current_assignments:
            db.add(ScheduledSession(
                schedule_run_id=new_run_id,
                session_id=ca.session_id,
                room_id=ca.room_id,
                time_slot_id=ca.time_slot_id,
                staff_id=ca.staff_id,
                day=ca.day,
                start_time=ca.start_time,
                end_time=ca.end_time,
                week_pattern=ca.week_pattern,
            ))
        db.flush()

        # Load reference data
        time_slots = db.query(TimeSlot).order_by(TimeSlot.day, TimeSlot.start_time).all()
        rooms = db.query(Room).order_by(Room.room_code).all()
        groups = db.query(StudentGroup).all()
        group_ids_by_code = {g.group_code.lower(): g.id for g in groups}
        soft_weights = self.priority_service.weights(db)

        # Helper: get staff IDs for a scheduled session
        def get_staff_ids(item: ScheduledSession) -> set:
            ids = set()
            for assignment in getattr(item.session, "staff_assignments", []) or []:
                if assignment.staff_id is not None:
                    ids.add(assignment.staff_id)
            if not ids and item.staff_id:
                ids.add(item.staff_id)
            return ids

        # Helper: get group IDs for a scheduled session
        def get_group_ids(item: ScheduledSession) -> set:
            ids = set()
            if item.session and item.session.student_group_id is not None:
                ids.add(item.session.student_group_id)
            if item.session:
                for code in required_student_group_codes(item.session):
                    gid = group_ids_by_code.get(code.lower())
                    if gid is not None:
                        ids.add(gid)
            return ids

        # Helper: check if two scheduled sessions conflict
        def sessions_conflict(left: ScheduledSession, right: ScheduledSession) -> bool:
            if left.session.is_lab_requirement and right.session.is_lab_requirement:
                return False
            return (
                left.day == right.day
                and session_weeks_conflict(left.session, left.time_slot, right.session, right.time_slot)
                and intervals_overlap(left.start_time, left.end_time, right.start_time, right.end_time)
            )

        # Helper: check if placing a session in a slot+room would conflict with any other session
        def placement_is_clean(target: ScheduledSession, slot: TimeSlot, room: Room, all_scheduled: list) -> bool:
            target_staff = get_staff_ids(target)
            target_groups = get_group_ids(target)
            for item in all_scheduled:
                if item.id == target.id:
                    continue
                if item.session.is_lab_requirement and target.session.is_lab_requirement:
                    continue
                if item.day != slot.day:
                    continue
                if not session_weeks_conflict(item.session, item.time_slot, target.session, slot):
                    continue
                if not intervals_overlap(item.start_time, item.end_time, slot.start_time, slot.end_time):
                    continue
                # There's a time overlap — check resource conflicts
                if item.room_id == room.id:
                    return False
                if target_groups.intersection(get_group_ids(item)):
                    return False
                if target_staff.intersection(get_staff_ids(item)):
                    return False
            return True

        # Helper: check if a slot is compatible with a session (duration, week pattern, avoid days)
        def slot_compatible(session, slot: TimeSlot, current: ScheduledSession) -> bool:
            if current.start_time and current.end_time:
                duration = (time_to_minutes(current.end_time) or 0) - (time_to_minutes(current.start_time) or 0)
                if slot.duration_minutes != duration:
                    return False
            if slot.week_pattern != current.week_pattern:
                return False
            if normalize_token(session.priority) == "hard" and slot.day in parse_day_list(session.avoid_days):
                return False
            return True

        # MAIN LOOP: iteratively find and fix conflicts
        max_iterations = 50  # safety limit
        total_moves = 0

        for iteration in range(max_iterations):
            scheduled = db.query(ScheduledSession).filter_by(schedule_run_id=new_run_id).all()

            # Find all hard conflict pairs (room, group, staff double bookings)
            conflicting_session_ids = set()
            for i, left in enumerate(scheduled):
                for right in scheduled[i + 1:]:
                    if not sessions_conflict(left, right):
                        continue
                    # Check resource overlap
                    if left.room_id == right.room_id:
                        conflicting_session_ids.add(left.session_id)
                        conflicting_session_ids.add(right.session_id)
                    if get_group_ids(left).intersection(get_group_ids(right)):
                        conflicting_session_ids.add(left.session_id)
                        conflicting_session_ids.add(right.session_id)
                    if get_staff_ids(left).intersection(get_staff_ids(right)):
                        conflicting_session_ids.add(left.session_id)
                        conflicting_session_ids.add(right.session_id)

            if not conflicting_session_ids:
                break  # No more conflicts!

            moved_any = False
            for session_id in conflicting_session_ids:
                target = next((s for s in scheduled if s.session_id == session_id), None)
                if target is None:
                    continue

                # Try to find a clean slot + room for this session
                best = None
                best_score = float("inf")
                for slot in time_slots:
                    if not slot_compatible(target.session, slot, target):
                        continue
                    for room in rooms:
                        if not candidate_room_allowed(target.session, room, relax_fixed=True):
                            continue
                        # Skip current placement
                        if target.room_id == room.id and target.time_slot_id == slot.id:
                            continue
                        if placement_is_clean(target, slot, room, scheduled):
                            # Score: prefer same day, same time, same room (fewer changes)
                            score = 0
                            if target.day != slot.day:
                                score += 1000
                            if target.start_time != slot.start_time:
                                score += 500
                            if target.room_id != room.id:
                                score += 100
                            if score < best_score:
                                best_score = score
                                best = (slot, room)

                if best is not None:
                    slot, room = best
                    target.time_slot_id = slot.id
                    target.room_id = room.id
                    target.day = slot.day
                    target.start_time = slot.start_time
                    target.end_time = slot.end_time
                    target.week_pattern = slot.week_pattern

                    # If this was a Fixed session, downgrade to Standard
                    session_obj = target.session
                    if session_obj.scheduling_type and normalize_token(session_obj.scheduling_type) == "fixed":
                        session_obj.scheduling_type = "Standard"
                        session_obj.fixed_day = None
                        session_obj.fixed_start_time = None
                        session_obj.fixed_end_time = None

                    db.flush()
                    total_moves += 1
                    moved_any = True
                    break  # Re-evaluate conflicts after each move

            if not moved_any:
                break  # No more moves possible

        db.flush()

        # Run constraint checks on the final schedule
        check = self.constraint_service.check_and_store(db, new_run_id, soft_weights)
        run = db.query(ScheduleRun).filter_by(id=new_run_id).one()
        run.hard_violation_count = check["hard_violation_count"]
        run.soft_score = check["weighted_soft_score"]
        run.solver_status = "OPTIMAL" if check["hard_violation_count"] == 0 else "FEASIBLE"
        run.status = "COMPLETED" if run.hard_violation_count == 0 else "COMPLETED_WITH_CONFLICTS"
        run.message = "Auto-deconflict moved %d session(s) to resolve conflicts." % total_moves
        db.commit()

        return {
            "schedule_run_id": new_run_id,
            "solver_status": run.solver_status,
            "hard_violation_count": run.hard_violation_count,
            "soft_warning_count": check["soft_warning_count"],
            "soft_score": run.soft_score,
            "quality": schedule_quality_summary(
                scheduled_count=len(current_assignments),
                hard_issue_count=run.hard_violation_count,
                soft_warning_count=check["soft_warning_count"],
                raw_soft_score=run.soft_score,
                affected_session_count=affected_session_count(check["violations"]),
            ),
            "generation_mode": "reproducible" if reproducible else "standard",
            "generation_seconds": round(perf_counter() - started_at, 1),
            "solver_timeout_seconds": 0,
            "message": run.message,
        }

