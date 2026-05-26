/*
 * Global workflow progress chart.
 * Fetches dashboard status and shows Import -> Validation -> Generation -> Success above every tab.
 */

import { CheckCircle2, FileUp, ShieldCheck, WandSparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { getDashboard } from "../api/client";
import type { Dashboard } from "../types";

type Props = {
  route: string;
};

const refreshEventName = "workflow-progress-refresh";

export function notifyWorkflowProgressChange() {
  window.dispatchEvent(new Event(refreshEventName));
}

export default function WorkflowProgress({ route }: Props) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState(false);

  const load = () => {
    getDashboard()
      .then((result) => {
        setDashboard(result);
        setError(false);
      })
      .catch(() => setError(true));
  };

  useEffect(load, [route]);

  useEffect(() => {
    window.addEventListener(refreshEventName, load);
    return () => window.removeEventListener(refreshEventName, load);
  }, []);

  const latest = dashboard?.latest_schedule ?? null;
  const hasImport = (dashboard?.imported_rows ?? 0) > 0;
  const validationClear = hasImport && dashboard?.validation.is_valid;
  const validationRan = hasImport;
  const generationRan = !!latest;
  const generationClear = !!latest && latest.status !== "FAILED";
  const success = !!latest && latest.status === "COMPLETED" && latest.hard_violation_count === 0;

  const processStages = [
    {
      label: "Import",
      detail: hasImport ? `${dashboard?.imported_rows ?? 0} rows loaded` : "Waiting for data",
      icon: FileUp,
      state: hasImport ? "complete" : "pending",
    },
    {
      label: "Validation",
      detail: validationRan
        ? validationClear
          ? "Checks clear"
          : `${dashboard?.validation.error_count ?? 0} errors`
        : "Not run",
      icon: ShieldCheck,
      state: validationClear ? "complete" : validationRan ? "attention" : "pending",
    },
    {
      label: "Generation",
      detail: generationRan ? latest?.solver_status ?? latest?.status ?? "Run complete" : "Not run",
      icon: WandSparkles,
      state: generationClear ? "complete" : generationRan ? "attention" : "pending",
    },
    {
      label: "Success",
      detail: success ? "Timetable ready" : latest ? `${latest.hard_violation_count} hard conflicts` : "Awaiting schedule",
      icon: CheckCircle2,
      state: success ? "complete" : latest ? "attention" : "pending",
    },
  ];

  return (
    <section className="process-flow global-process-flow" aria-label="Scheduling process flow">
      {processStages.map((stage, index) => {
        const Icon = stage.icon;
        return (
          <div className={`process-stage ${stage.state}`} key={stage.label}>
            <div className="process-step">
              <div className="process-icon">
                <Icon size={18} />
              </div>
              <div>
                <strong>{stage.label}</strong>
                <span>{error ? "Unable to refresh" : stage.detail}</span>
              </div>
            </div>
            {index < processStages.length - 1 && <div className={`process-line ${stage.state}`} />}
          </div>
        );
      })}
    </section>
  );
}
