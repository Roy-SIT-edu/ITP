import { describe, expect, it } from "vitest";
import type { ReportWorkloadItem } from "../types";
import { rankWorkloadItems, workloadMaximum } from "./reportWorkload";

const items: ReportWorkloadItem[] = [
  { label: "Alpha", session_count: 8, hours: 30 },
  { label: "Beta", session_count: 12, hours: 24 },
  { label: "Gamma", session_count: 10, hours: 40 },
];

describe("report workload graph data", () => {
  it("ranks and limits resources by the selected metric without changing the source data", () => {
    expect(rankWorkloadItems(items, "session_count", 2).map((item) => item.label)).toEqual(["Beta", "Gamma"]);
    expect(rankWorkloadItems(items, "hours", 2).map((item) => item.label)).toEqual(["Gamma", "Alpha"]);
    expect(items.map((item) => item.label)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("uses one maximum across resource groups so their bars share a scale", () => {
    expect(workloadMaximum([items, [{ label: "Delta", session_count: 15, hours: 28 }]], "session_count")).toBe(15);
    expect(workloadMaximum([items], "hours")).toBe(40);
  });
});
