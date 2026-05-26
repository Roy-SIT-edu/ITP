/*
 * Read-only timetable grid for reviewing generated scheduled sessions.
 */

import type { ScheduledRow } from "../types";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

type Props = {
  rows: ScheduledRow[];
};

export default function TimetableGrid({ rows }: Props) {
  return (
    <>
      <div className="timetable-board">
        {days.map((day) => (
          <section className="day-column" key={day}>
            <h3>{day}</h3>
            <div className="day-events">
              {rows.filter((row) => row.day === day).length === 0 && <span className="muted">No sessions</span>}
              {rows
                .filter((row) => row.day === day)
                .sort((left, right) => left.start_time.localeCompare(right.start_time))
                .map((row) => (
                  <article
                    className={row.delivery_mode === "Online" || row.room.includes("VIRTUAL") ? "event virtual" : "event"}
                    key={`${row.requirement_id}-${row.day}-${row.start_time}-${row.room}`}
                  >
                    <strong>{row.module_code ?? row.requirement_id}</strong>
                    <span>
                      {row.start_time}-{row.end_time} · {row.room}
                    </span>
                    <small>{row.student_group_code ?? "No group"} · {row.staff_name ?? "No staff"}</small>
                  </article>
                ))}
            </div>
          </section>
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Programme</th>
              <th>Module</th>
              <th>Type</th>
              <th>Group</th>
              <th>Staff</th>
              <th>Room</th>
              <th>Day</th>
              <th>Start</th>
              <th>End</th>
              <th>Weeks</th>
              <th>Mode</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.requirement_id}-${row.day}-${row.start_time}-${row.room}`}>
                <td>{row.programme}</td>
                <td>{row.module_code}</td>
                <td>{row.class_type}</td>
                <td>{row.student_group_code}</td>
                <td>{row.staff_name}</td>
                <td>{row.room}</td>
                <td>{row.day}</td>
                <td>{row.start_time}</td>
                <td>{row.end_time}</td>
                <td>{row.week_pattern}</td>
                <td>{row.delivery_mode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
