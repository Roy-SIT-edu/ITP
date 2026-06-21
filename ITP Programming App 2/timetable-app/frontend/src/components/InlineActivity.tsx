/*
 * Small non-blocking progress panel used between workflow stages.
 * It stays inline with the current page so users can keep reading/navigating.
 */

import { CheckCircle2, FileSpreadsheet, ListChecks, Loader2, Rows3, Sparkles } from "lucide-react";

type ActivityKind = "import" | "validate" | "generate" | "review" | "export";

type Props = {
  kind: ActivityKind;
  title: string;
  steps: string[];
};

const icons = {
  import: FileSpreadsheet,
  validate: ListChecks,
  generate: Sparkles,
  review: Rows3,
  export: CheckCircle2,
};

export default function InlineActivity({ kind, title, steps }: Props) {
  const Icon = icons[kind];

  return (
    <section className={`inline-activity ${kind}`} aria-live="polite" aria-busy="true">
      <div className="inline-activity-icon">
        <Icon size={18} />
      </div>
      <div className="inline-activity-copy">
        <strong>{title}</strong>
        <div className="inline-activity-steps">
          {steps.map((step) => (
            <span key={step}>{step}</span>
          ))}
        </div>
      </div>
      <Loader2 className="inline-activity-spinner" size={18} />
    </section>
  );
}
