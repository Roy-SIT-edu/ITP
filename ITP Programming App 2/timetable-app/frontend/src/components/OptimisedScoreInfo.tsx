import { Info } from "lucide-react";
import type { ScheduleQuality } from "../types";

type Props = {
  quality?: ScheduleQuality;
};

export default function OptimisedScoreInfo({ quality }: Props) {
  return (
    <details className="optimised-score-info">
      <summary aria-label="How the optimised score is calculated" title="How the optimised score is calculated">
        <Info size={15} />
      </summary>
      <div className="optimised-score-popover" role="note">
        <strong>How the score is calculated</strong>
        <p>The score starts at 100. Points are deducted for:</p>
        <ul>
          <li>hard conflicts, up to 70 points (18 each, plus their affected-session impact)</li>
          <li>soft warnings per scheduled session, up to 35 points</li>
          <li>the share of sessions affected by issues, up to 20 points</li>
          <li>missed preferences, weighted by priority per session, up to 15 points</li>
        </ul>
        <div className="optimised-score-formula">
          100 - hard penalty - warning penalty - affected-session penalty - preference penalty
        </div>
        <p>If any hard conflict remains, the final score is capped at 49. A higher score is better.</p>
        {quality && (
          <div className="optimised-score-current">
            This run: {quality.hard_issue_count} hard, {quality.soft_warning_count} soft, and{" "}
            {quality.affected_session_percent}% of sessions affected.
          </div>
        )}
      </div>
    </details>
  );
}
