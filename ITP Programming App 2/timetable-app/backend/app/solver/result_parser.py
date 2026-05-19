from __future__ import annotations

from ortools.sat.python import cp_model


class ResultParser:
    def parse(self, solver: cp_model.CpSolver, assignments: list[dict]) -> list[dict]:
        results = []
        for assignment in assignments:
            if solver.BooleanValue(assignment["variable"]):
                session = assignment["session"]
                slot = assignment["time_slot"]
                room = assignment["room"]
                results.append(
                    {
                        "session_id": session.id,
                        "room_id": room.id,
                        "time_slot_id": slot.id,
                        "staff_id": session.staff_id,
                        "day": slot.day,
                        "start_time": slot.start_time,
                        "end_time": slot.end_time,
                        "week_pattern": session.week_pattern or slot.week_pattern,
                    }
                )
        return results
