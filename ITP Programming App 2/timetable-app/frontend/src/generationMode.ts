import { useState } from "react";

export type GenerationMode = "standard" | "reproducible";

const GENERATION_MODE_STORAGE_KEY = "timetable.generationMode";
const GENERATION_RUNTIME_STORAGE_KEY = "timetable.generationRuntimeHistory";
const DEFAULT_GENERATION_SECONDS: Record<GenerationMode, number> = {
  standard: 25,
  reproducible: 120,
};

type GenerationRuntimeHistory = Record<GenerationMode, number[]>;

export function getGenerationMode(): GenerationMode {
  try {
    return window.localStorage.getItem(GENERATION_MODE_STORAGE_KEY) === "reproducible" ? "reproducible" : "standard";
  } catch {
    return "standard";
  }
}

export function generationModeLabel(mode: GenerationMode) {
  return mode === "reproducible" ? "Standard" : "Fast";
}

function getGenerationRuntimeHistory(): GenerationRuntimeHistory {
  const emptyHistory: GenerationRuntimeHistory = { standard: [], reproducible: [] };
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(GENERATION_RUNTIME_STORAGE_KEY) ?? "null",
    ) as Partial<GenerationRuntimeHistory> | null;
    if (!stored) return emptyHistory;
    return {
      standard: Array.isArray(stored.standard) ? stored.standard.filter(Number.isFinite).slice(-5) : [],
      reproducible: Array.isArray(stored.reproducible) ? stored.reproducible.filter(Number.isFinite).slice(-5) : [],
    };
  } catch {
    return emptyHistory;
  }
}

export function estimateGenerationSeconds(mode: GenerationMode) {
  const samples = getGenerationRuntimeHistory()[mode];
  if (samples.length === 0) return DEFAULT_GENERATION_SECONDS[mode];
  return Math.max(5, Math.round(samples.reduce((total, value) => total + value, 0) / samples.length));
}

export function rememberGenerationSeconds(mode: GenerationMode, seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  try {
    const history = getGenerationRuntimeHistory();
    history[mode] = [...history[mode], seconds].slice(-5);
    window.localStorage.setItem(GENERATION_RUNTIME_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Runtime learning is optional when browser storage is unavailable.
  }
}

export function formatGenerationDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes === 0) return `${remainder}s`;
  return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
}

export function useGenerationMode() {
  const [generationMode, setGenerationModeState] = useState<GenerationMode>(() => getGenerationMode());

  const setGenerationMode = (mode: GenerationMode) => {
    try {
      window.localStorage.setItem(GENERATION_MODE_STORAGE_KEY, mode);
    } catch {
      // The current page still keeps the preference when browser storage is unavailable.
    }
    setGenerationModeState(mode);
  };

  return { generationMode, setGenerationMode };
}
