import type { ScheduleGenerateResult } from "../types";
import SolverProgress from "./SolverProgress";

type AutoDeconflictStatusProps = {
  running: boolean;
  elapsedSeconds: number;
  estimatedSeconds: number;
  result: ScheduleGenerateResult | null;
};

export default function AutoDeconflictStatus({
  running,
  elapsedSeconds,
  estimatedSeconds,
  result,
}: AutoDeconflictStatusProps) {
  if (running) {
    return (
      <section className="status-card generation-panel review-deconflict-panel" style={{ marginTop: "1rem" }}>
        <div className="generation-copy">
          <div className="status-card-title">Auto-Deconflicting Schedule</div>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            Checking hard conflicts and trying safe moves for uploaded sessions. Built-in lab bookings remain fixed.
          </p>
        </div>
        <SolverProgress
          ariaLabel="Estimated auto deconflict progress"
          elapsedSeconds={elapsedSeconds}
          estimatedSeconds={estimatedSeconds}
        />
      </section>
    );
  }

  if (!result) return null;

  const remainingHard = result.remaining_hard_violation_count ?? result.hard_violation_count;
  const moved = result.moved_session_count ?? 0;
  const unresolvedLabIds = result.unresolved_lab_session_ids ?? result.unresolved_fixed_session_ids ?? [];

  return (
    <div className={`notice ${remainingHard > 0 ? "bad" : "good"}`} role="status">
      {result.timed_out ? "Time limit reached; the best safe version was saved." : "Auto-deconflict finished."} Moved
      sessions: {moved}. Remaining hard conflicts: {remainingHard}.
      {unresolvedLabIds.length > 0
        ? ` Built-in lab session IDs requiring manual review: ${unresolvedLabIds.join(", ")}.`
        : ""}
    </div>
  );
}
