/*
 * Global workflow stepper.
 * Fetches dashboard status and turns the main scheduling process into the
 * primary navigation path.
 */

import { useEffect, useState } from "react";
import { getDashboard } from "../api/client";
import type { Dashboard } from "../types";

type Props = {
  route: string;
  onNavigate: (route: string) => void;
};

const refreshEventName = "workflow-progress-refresh";

export function notifyWorkflowProgressChange() {
  window.dispatchEvent(new Event(refreshEventName));
}

export default function WorkflowProgress({ route, onNavigate }: Props) {
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
      id: "upload",
      label: "Import Data",
      detail: hasImport ? `${dashboard?.imported_rows ?? 0} rows loaded` : "Waiting for data",
      state: hasImport ? "complete" : "pending",
      locked: false,
    },
    {
<<<<<<< Updated upstream
      id: "validation",
      step: 2,
      label: "Validate Data",
      detail: validationRan
        ? validationClear
          ? "Checks clear"
          : `${dashboard?.validation.error_count ?? 0} errors`
        : "Not run",
      state: validationClear ? "complete" : validationRan ? "attention" : "pending",
=======
      id: "soft-constraints",
      label: "Priorities",
      detail: hasImport ? "Rank soft constraints" : "Import first",
      state: hasImport ? "complete" : "pending",
>>>>>>> Stashed changes
      locked: !hasImport,
    },
    {
      id: "soft-constraints",
      step: 3,
      label: "Priorities & Generate",
      detail: validationClear ? (generationRan ? "Generated" : "Ready to generate") : "Validate first",
      state: generationRan ? "complete" : validationClear ? "ready" : validationRan ? "attention" : "pending",
      locked: !validationClear,
    },
    {
      id: "review",
<<<<<<< Updated upstream
      step: 4,
=======
>>>>>>> Stashed changes
      label: "Review Timetable",
      detail: generationRan ? latest?.solver_status ?? latest?.status ?? "Review schedule" : "Generate first",
      state: generationClear ? "complete" : generationRan ? "attention" : "pending",
      locked: !generationRan,
    },
    {
      id: "export",
<<<<<<< Updated upstream
      step: 5,
=======
>>>>>>> Stashed changes
      label: "Export Timetable",
      detail: success ? "Ready to export" : latest ? `${latest.hard_violation_count} hard conflicts` : "Review first",
      state: success ? "complete" : latest ? "attention" : "pending",
      locked: !generationRan,
    },
  ];

  return (
    <nav className="workflow-stepper" aria-label="Scheduling workflow">
      {processStages.map((stage, index) => {
        const active = route === stage.id;
        return (
          <div className={`workflow-stage ${stage.state} ${active ? "active" : ""} ${stage.locked ? "locked" : ""}`} key={stage.id}>
            <a
              aria-current={active ? "page" : undefined}
              aria-disabled={stage.locked}
              className="workflow-step-link"
              href={`#${stage.id}`}
              onClick={(event) => {
                if (stage.locked) {
                  event.preventDefault();
                  return;
                }
                onNavigate(stage.id);
              }}
              title={stage.locked ? stage.detail : undefined}
            >
              <div>
                <strong>{stage.label}</strong>
                <span>{error ? "Unable to refresh" : stage.detail}</span>
              </div>
            </a>
            {index < processStages.length - 1 && <div className={`workflow-line ${stage.state}`} />}
          </div>
        );
      })}
    </nav>
  );
}
