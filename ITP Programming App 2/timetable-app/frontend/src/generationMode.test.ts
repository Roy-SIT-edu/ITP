import { beforeEach, describe, expect, it } from "vitest";

import {
  estimateAutoDeconflictSeconds,
  rememberAutoDeconflictSeconds,
  rememberGenerationSeconds,
} from "./generationMode";

describe("auto-deconflict runtime estimates", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("falls back to the learned standard generation estimate before its first run", () => {
    rememberGenerationSeconds("standard", 12);
    rememberGenerationSeconds("standard", 18);

    expect(estimateAutoDeconflictSeconds()).toBe(15);
  });

  it("averages the five most recent auto-deconflict runtimes", () => {
    [10, 20, 30, 40, 50, 60].forEach(rememberAutoDeconflictSeconds);

    expect(estimateAutoDeconflictSeconds()).toBe(40);
  });

  it("keeps the shared five-second minimum estimate", () => {
    rememberAutoDeconflictSeconds(1);

    expect(estimateAutoDeconflictSeconds()).toBe(5);
  });
});
