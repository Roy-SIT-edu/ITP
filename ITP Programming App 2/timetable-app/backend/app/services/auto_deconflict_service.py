"""Safe, deterministic conflict reduction for an existing schedule run."""

from __future__ import annotations

from time import perf_counter

from app.models.room import Room
from app.models.schedule_run import ScheduleRun
from app.models.scheduled_session import ScheduledSession
from app.models.student_group import StudentGroup
from app.models.time_slot import TimeSlot
from app.services.academic_calendar_service import AcademicCalendarService
from app.services.compatibility import intervals_overlap, session_weeks_conflict
from app.services.constraint_service import ConstraintService
from app.services.lab_overlap_service import LabOverlapService
from app.services.schedule_quality_service import affected_session_count, schedule_quality_summary
from app.services.scheduling_constants import SCHEDULING_DAY_END_TIME
from app.services.scheduling_rules import candidate_room_allowed, candidate_slot_allowed, required_student_group_codes
from app.services.soft_constraint_priority_service import SoftConstraintPriorityService
from sqlalchemy.orm import Session as DbSession

class ScheduleRunNotFoundError(ValueError):
    """Raised when a requested schedule run does not exist."""


class AutoDeconflictConflictError(ValueError):
    """Raised when a schedule run cannot be auto-deconflicted."""


class AutoDeconflictService:
    def __init__(self) -> None:
        self.constraint_service = ConstraintService()
        self.priority_service = SoftConstraintPriorityService()
        self.lab_overlap_service = LabOverlapService()

    def run(
        self,
        db: DbSession,
        schedule_run_id: int,
        timeout: float | None = None,
    ) -> dict:
        """Create a derived run by moving only flexible sessions to reduce hard conflicts."""

        started_at = perf_counter()
        effective_timeout = timeout
        source_run = db.query(ScheduleRun).filter_by(id=schedule_run_id).first()
        if source_run is None:
            raise ScheduleRunNotFoundError("Schedule run not found")
        if source_run.status not in {"COMPLETED", "COMPLETED_WITH_CONFLICTS"}:
            raise AutoDeconflictConflictError("Only completed schedule runs can be auto-deconflicted")

        source_assignments = (
            db.query(ScheduledSession)
            .filter_by(schedule_run_id=schedule_run_id)
            .order_by(ScheduledSession.session_id, ScheduledSession.id)
            .all()
        )
        if not source_assignments:
            raise AutoDeconflictConflictError("The schedule run has no assignments to deconflict")

        source_hard_violations = self._hard_violations(db, schedule_run_id)
        if not source_hard_violations:
            raise AutoDeconflictConflictError("The schedule run has no hard conflicts")

        # Default priority initialization may commit. Complete it before the
        # derived run is created so rollback can always remove the entire run.
        soft_weights = self.priority_service.weights(db)

        try:
            run = ScheduleRun(
                status="RUNNING",
                solver_status=source_run.solver_status,
                message=f"Auto-deconflict started from run #{schedule_run_id}",
                academic_year=source_run.academic_year,
                trimester=source_run.trimester,
            )
            db.add(run)
            db.flush()
            new_run_id = run.id
            self._copy_assignments(db, source_assignments, new_run_id)
            lab_overlap_resolution = self.lab_overlap_service.resolve_run(db, new_run_id)

            time_slots = (
                db.query(TimeSlot)
                .filter(TimeSlot.end_time <= SCHEDULING_DAY_END_TIME)
                .order_by(TimeSlot.day, TimeSlot.start_time, TimeSlot.id)
                .all()
            )
            rooms = db.query(Room).order_by(Room.room_code, Room.id).all()
            group_ids_by_code = {group.group_code.lower(): group.id for group in db.query(StudentGroup).order_by(StudentGroup.id).all()}
            total_moves = 0
            timed_out = False

            def deadline_reached() -> bool:
                return effective_timeout is not None and perf_counter() - started_at >= effective_timeout

            while True:
                if deadline_reached():
                    timed_out = True
                    break

                scheduled = self._scheduled(db, new_run_id)
                hard_violations = self._hard_violations(db, new_run_id)
                if not hard_violations:
                    break

                affected_ids = {session_id for violation in hard_violations for session_id in violation["affected_session_ids"]}
                targets = [item for item in scheduled if item.session_id in affected_ids and self._movable(item)]
                ranked_targets = []
                for target in targets:
                    placements = self._candidate_placements(
                        target,
                        scheduled,
                        time_slots,
                        rooms,
                        group_ids_by_code,
                        deadline_reached,
                    )
                    if placements:
                        ranked_targets.append((len(placements), target.session_id, target, placements))
                ranked_targets.sort(key=lambda item: (item[0], item[1]))

                moved = False
                current_hard_count = len(hard_violations)
                for _, _, target, placements in ranked_targets:
                    for _, slot, room in placements:
                        if deadline_reached():
                            timed_out = True
                            break
                        previous = self._placement(target)
                        self._apply_placement(target, slot, room)
                        db.flush()
                        if len(self._hard_violations(db, new_run_id)) < current_hard_count:
                            total_moves += 1
                            moved = True
                            break
                        self._restore_placement(target, previous)
                        db.flush()
                    if moved or timed_out:
                        break
                if timed_out or not moved:
                    break

            check = self.constraint_service.check_and_store(db, new_run_id, soft_weights)
            final_scheduled = self._scheduled(db, new_run_id)
            sessions_by_id = {item.session_id: item.session for item in final_scheduled}
            unresolved_fixed_ids = sorted(
                {
                    session_id
                    for violation in check["violations"]
                    if violation["severity"] == "HARD"
                    for session_id in violation["affected_session_ids"]
                    if session_id in sessions_by_id and sessions_by_id[session_id].is_lab_requirement
                }
            )

            run.hard_violation_count = check["hard_violation_count"]
            run.soft_score = check["weighted_soft_score"]
            run.status = "COMPLETED" if run.hard_violation_count == 0 else "COMPLETED_WITH_CONFLICTS"
            timeout_note = " The time limit was reached." if timed_out else ""
            run.message = (
                f"Auto-deconflict from run #{schedule_run_id} moved {total_moves} session(s); "
                f"{run.hard_violation_count} hard conflict(s) remain.{timeout_note}"
            )
            AcademicCalendarService().sync_run_occurrences(db, run)
            db.commit()

            return {
                "schedule_run_id": new_run_id,
                "academic_year": run.academic_year,
                "trimester": run.trimester,
                "source_schedule_run_id": schedule_run_id,
                "solver_status": run.solver_status or "UNKNOWN",
                "hard_violation_count": run.hard_violation_count,
                "remaining_hard_violation_count": run.hard_violation_count,
                "moved_session_count": total_moves,
                "timed_out": timed_out,
                "unresolved_fixed_session_ids": unresolved_fixed_ids,
                "unresolved_lab_session_ids": unresolved_fixed_ids,
                "soft_warning_count": check["soft_warning_count"],
                "soft_score": run.soft_score,
                "quality": schedule_quality_summary(
                    scheduled_count=len(final_scheduled),
                    hard_issue_count=run.hard_violation_count,
                    soft_warning_count=check["soft_warning_count"],
                    raw_soft_score=run.soft_score,
                    affected_session_count=affected_session_count(check["violations"]),
                ),
                "generation_mode": "standard",
                "generation_seconds": round(perf_counter() - started_at, 1),
                "solver_timeout_seconds": effective_timeout,
                "lab_overlap_pair_count": lab_overlap_resolution["detected_pair_count"],
                "excluded_lab_session_count": lab_overlap_resolution["excluded_session_count"],
                "excluded_lab_session_ids": lab_overlap_resolution["excluded_session_ids"],
                "message": run.message,
            }
        except Exception:
            db.rollback()
            raise

    def _candidate_placements(
        self,
        target: ScheduledSession,
        scheduled: list[ScheduledSession],
        time_slots: list[TimeSlot],
        rooms: list[Room],
        group_ids_by_code: dict[str, int],
        deadline_reached,
    ) -> list[tuple[tuple, TimeSlot, Room]]:
        candidates = []
        staff_by_assignment_id = {item.id: self._staff_ids(item) for item in scheduled}
        groups_by_assignment_id = {item.id: self._group_ids(item, group_ids_by_code) for item in scheduled}
        target_staff = staff_by_assignment_id[target.id]
        target_groups = groups_by_assignment_id[target.id]
        scheduled_by_day: dict[str, list[ScheduledSession]] = {}
        for item in scheduled:
            scheduled_by_day.setdefault(item.day, []).append(item)

        for slot in time_slots:
            if deadline_reached():
                break
            if not candidate_slot_allowed(target.session, slot, relax_fixed=True):
                continue

            occupied_room_ids: set[int] = set()
            resource_conflict = False
            for item in scheduled_by_day.get(slot.day, []):
                if item.id == target.id:
                    continue
                if item.session.is_lab_requirement and target.session.is_lab_requirement:
                    continue
                if not session_weeks_conflict(item.session, item.time_slot, target.session, slot):
                    continue
                if not intervals_overlap(item.start_time, item.end_time, slot.start_time, slot.end_time):
                    continue
                occupied_room_ids.add(item.room_id)
                if target_groups.intersection(groups_by_assignment_id[item.id]) or target_staff.intersection(
                    staff_by_assignment_id[item.id]
                ):
                    resource_conflict = True
                    break
            if resource_conflict:
                continue

            for room in rooms:
                if deadline_reached():
                    break
                if target.room_id == room.id and target.time_slot_id == slot.id:
                    continue
                if not candidate_room_allowed(target.session, room):
                    continue
                if room.id in occupied_room_ids:
                    continue
                score = (
                    int(target.day != slot.day),
                    int(target.start_time != slot.start_time),
                    int(target.room_id != room.id),
                    slot.day,
                    slot.start_time,
                    slot.id,
                    room.room_code,
                    room.id,
                )
                candidates.append((score, slot, room))
        return sorted(candidates, key=lambda item: item[0])

    @staticmethod
    def _copy_assignments(
        db: DbSession,
        source_assignments: list[ScheduledSession],
        new_run_id: int,
    ) -> None:
        for assignment in source_assignments:
            db.add(
                ScheduledSession(
                    schedule_run_id=new_run_id,
                    session_id=assignment.session_id,
                    room_id=assignment.room_id,
                    time_slot_id=assignment.time_slot_id,
                    staff_id=assignment.staff_id,
                    day=assignment.day,
                    start_time=assignment.start_time,
                    end_time=assignment.end_time,
                    week_pattern=assignment.week_pattern,
                    included_in_final=assignment.included_in_final,
                )
            )
        db.flush()

    @staticmethod
    def _movable(item: ScheduledSession) -> bool:
        return not item.session.is_lab_requirement

    @staticmethod
    def _staff_ids(item: ScheduledSession) -> set[int]:
        ids = {
            assignment.staff_id for assignment in getattr(item.session, "staff_assignments", []) or [] if assignment.staff_id is not None
        }
        if not ids and item.staff_id is not None:
            ids.add(item.staff_id)
        return ids

    @staticmethod
    def _group_ids(item: ScheduledSession, group_ids_by_code: dict[str, int]) -> set[int]:
        ids = {item.session.student_group_id} if item.session.student_group_id is not None else set()
        for code in required_student_group_codes(item.session):
            group_id = group_ids_by_code.get(code.lower())
            if group_id is not None:
                ids.add(group_id)
        return ids

    def _hard_violations(self, db: DbSession, schedule_run_id: int) -> list[dict]:
        return [item for item in self.constraint_service.check_schedule(db, schedule_run_id) if item["severity"] == "HARD"]

    @staticmethod
    def _scheduled(db: DbSession, schedule_run_id: int) -> list[ScheduledSession]:
        return (
            db.query(ScheduledSession)
            .filter(
                ScheduledSession.schedule_run_id == schedule_run_id,
                ScheduledSession.included_in_final.is_(True),
            )
            .order_by(ScheduledSession.session_id, ScheduledSession.id)
            .all()
        )

    @staticmethod
    def _placement(item: ScheduledSession) -> tuple:
        return (
            item.time_slot_id,
            item.room_id,
            item.day,
            item.start_time,
            item.end_time,
            item.week_pattern,
            item.time_slot,
            item.room,
        )

    @staticmethod
    def _apply_placement(item: ScheduledSession, slot: TimeSlot, room: Room) -> None:
        item.time_slot_id = slot.id
        item.room_id = room.id
        item.day = slot.day
        item.start_time = slot.start_time
        item.end_time = slot.end_time
        item.week_pattern = slot.week_pattern
        item.time_slot = slot
        item.room = room

    @staticmethod
    def _restore_placement(item: ScheduledSession, placement: tuple) -> None:
        (
            item.time_slot_id,
            item.room_id,
            item.day,
            item.start_time,
            item.end_time,
            item.week_pattern,
            item.time_slot,
            item.room,
        ) = placement
