import type { ReportWorkloadItem } from "../types";

export type WorkloadMetric = "session_count" | "hours";

export function rankWorkloadItems(items: ReportWorkloadItem[], metric: WorkloadMetric, limit: number) {
  const secondaryMetric: WorkloadMetric = metric === "session_count" ? "hours" : "session_count";
  return [...items]
    .sort(
      (left, right) =>
        right[metric] - left[metric] ||
        right[secondaryMetric] - left[secondaryMetric] ||
        left.label.localeCompare(right.label),
    )
    .slice(0, Math.max(0, limit));
}

export function workloadMaximum(groups: ReportWorkloadItem[][], metric: WorkloadMetric) {
  return Math.max(1, ...groups.flatMap((items) => items.map((item) => item[metric])));
}
