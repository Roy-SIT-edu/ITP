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

type ProcessStage = {
  id: string;
  step?: number;
  label: string;
  detail: string;
  state: string;
  locked: boolean;
};

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

  const generationRan = !!latest;
  const generationClear = !!latest && latest.status !== "FAILED";
  const success = !!latest && latest.status === "COMPLETED" && latest.hard_violation_count === 0;

  const processStages: ProcessStage[] = [
    {
      id: "upload",
      label: "Import Data",
      detail: hasImport ? `${dashboard?.imported_rows ?? 0} rows loaded` : "Waiting for data",
      state: hasImport ? "complete" : "pending",
      locked: false,
    },
    {
      id: "soft-constraints",
      step: 2,
      label: "Generate Timetable",
      detail: hasImport ? (generationRan ? "Generated" : "Ready to generate") : "Import data first",
      state: generationRan ? "complete" : hasImport ? "ready" : "pending",
      locked: !hasImport,
    },
    {
      id: "review",
      step: 4,
      label: "Review Timetable",
      detail: generationRan ? (latest?.solver_status ?? latest?.status ?? "Review schedule") : "Generate first",
      state: generationClear ? "complete" : generationRan ? "attention" : "pending",
      locked: !generationRan,
    },
    {
      id: "export",
      step: 5,
      label: "Export Timetable",
      detail: success ? "Ready to export" : latest ? `${latest.hard_violation_count} hard conflicts` : "Review first",
      state: success ? "complete" : latest ? "attention" : "pending",
      locked: !generationRan,
    },
  ];
  const activeIndex = processStages.findIndex((stage) => stage.id === route);
  const activeStage = activeIndex >= 0 ? processStages[activeIndex] : null;
  const nextStage = processStages.find((stage, index) => index > activeIndex && !stage.locked) ?? null;

  return (
    <>
      <div className="workflow-compact" aria-label="Current workflow status">
        <div>
          <span>Current Step</span>
          <strong>{activeStage?.label ?? "Overview"}</strong>
        </div>
        <p>{error ? "Unable to refresh workflow status" : (activeStage?.detail ?? "Open a workflow step to begin.")}</p>
        {nextStage && (
          <a className="button secondary slim" href={`#${nextStage.id}`} onClick={() => onNavigate(nextStage.id)}>
            Next: {nextStage.label}
          </a>
        )}
      </div>
      <nav className="workflow-stepper" aria-label="Scheduling workflow">
        {processStages.map((stage, index) => {
          const active = route === stage.id;
          return (
            <div
              className={`workflow-stage ${stage.state} ${active ? "active" : ""} ${stage.locked ? "locked" : ""}`}
              key={stage.id}
            >
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
    </>
  );
}
