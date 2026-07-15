import { afterEach, describe, expect, it, vi } from "vitest";

import { autoDeconflict } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("autoDeconflict", () => {
  it("sends the configurable timeout and returns the compatible result", async () => {
    const payload = {
      schedule_run_id: 9,
      source_schedule_run_id: 4,
      solver_status: "FEASIBLE",
      hard_violation_count: 0,
      remaining_hard_violation_count: 0,
      moved_session_count: 1,
      timed_out: false,
      unresolved_fixed_session_ids: [],
      soft_score: 0,
      message: "Completed",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(autoDeconflict(4, 12)).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith("/api/schedules/4/auto-deconflict?timeout_seconds=12", {
      method: "POST",
    });
  });

  it("surfaces API failure details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "The schedule run has no hard conflicts" }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(autoDeconflict(4)).rejects.toMatchObject({
      status: 409,
      message: "The schedule run has no hard conflicts",
    });
  });
});
