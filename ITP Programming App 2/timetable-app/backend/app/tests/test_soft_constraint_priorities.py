"""Tests for user-ranked soft constraint weights."""

from app.models.room import Room
from app.models.session import Session
from app.models.time_slot import TimeSlot
from app.services.soft_constraint_priority_service import SoftConstraintPriorityService
from app.solver.cp_sat_solver import CpSatTimetableSolver


def test_soft_constraint_ranking_updates_weights(db_session):
    service = SoftConstraintPriorityService()

    priorities = service.update_priorities(
        db_session,
        ["ONLINE_NOT_MON_TUE", "AVOID_DAY", "PREFERRED_DAY_MISMATCH"],
    )

    assert priorities[0]["constraint_code"] == "ONLINE_NOT_MON_TUE"
    assert priorities[0]["rank"] == 1
    assert priorities[0]["weight"] > priorities[-1]["weight"]


def test_omitted_soft_constraints_are_zero_weighted(db_session):
    service = SoftConstraintPriorityService()

    priorities = service.update_priorities(
        db_session,
        ["AVOID_DAY", "PREFERRED_DAY_MISMATCH"],
    )
    weights = service.weights(db_session)

    assert [item["constraint_code"] for item in priorities[:2]] == ["AVOID_DAY", "PREFERRED_DAY_MISMATCH"]
    assert priorities[0]["weight"] > priorities[1]["weight"] > 0
    assert weights["TUTOR_IDLE_GAP"] == 0
    assert weights["ONLINE_NOT_MON_TUE"] == 0


def test_solver_accepts_ranked_soft_constraint_weights(db_session):
    weights = SoftConstraintPriorityService().weights(db_session)

    result = CpSatTimetableSolver().solve(
        db_session.query(Session).all(),
        db_session.query(TimeSlot).all(),
        db_session.query(Room).all(),
        soft_constraint_weights=weights,
        max_seconds=5,
    )

    assert result["solver_status"] in {"FEASIBLE", "OPTIMAL"}
    assert isinstance(result["soft_score"], int)
