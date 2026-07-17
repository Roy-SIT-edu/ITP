import { Clock3 } from "lucide-react";

import { formatGenerationDuration } from "../generationMode";

type SolverProgressProps = {
  ariaLabel: string;
  completing?: boolean;
  elapsedSeconds: number;
  estimatedSeconds: number;
};

export default function SolverProgress({
  ariaLabel,
  completing = false,
  elapsedSeconds,
  estimatedSeconds,
}: SolverProgressProps) {
  const estimatedProgress =
    estimatedSeconds > 0 ? Math.min(90, Math.max(4, Math.round((elapsedSeconds / estimatedSeconds) * 90))) : 0;
  const progress = completing ? 100 : estimatedProgress;
  const estimatedRemaining = Math.max(0, estimatedSeconds - elapsedSeconds);
  const stalled = !completing && estimatedRemaining === 0;

  return (
    <div className="solver-progress" aria-live="polite">
      <div className="solver-progress-heading">
        <span>
          <Clock3 size={16} />
          <strong>{formatGenerationDuration(elapsedSeconds)}</strong> elapsed
        </span>
        <span>
          {completing
            ? "Schedule generated"
            : estimatedRemaining > 0
              ? `About ${formatGenerationDuration(estimatedRemaining)} remaining`
              : "Still solving"}
        </span>
      </div>
      <div
        aria-label={ariaLabel}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progress}
        className="solver-progress-track"
        role="progressbar"
      >
        <span
          className={`solver-progress-fill ${stalled ? "stalled" : ""} ${completing ? "completing" : ""}`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <p>Estimated progress {progress}%</p>
    </div>
  );
}
