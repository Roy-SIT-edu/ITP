import { useState } from "react";

export type GenerationMode = "standard" | "reproducible";

const GENERATION_MODE_STORAGE_KEY = "timetable.generationMode";

export function getGenerationMode(): GenerationMode {
  try {
    return window.localStorage.getItem(GENERATION_MODE_STORAGE_KEY) === "reproducible"
      ? "reproducible"
      : "standard";
  } catch {
    return "standard";
  }
}

export function generationModeLabel(mode: GenerationMode) {
  return mode === "reproducible" ? "Reproducible" : "Standard";
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
