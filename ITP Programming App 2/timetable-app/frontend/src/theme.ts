import { useEffect, useState } from "react";

export type ThemeMode = "light" | "night";

const THEME_STORAGE_KEY = "timetable.themeMode";

function storedTheme(): ThemeMode {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "night" ? "night" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode === "night" ? "dark" : "light";
}

export function initializeTheme() {
  applyTheme(storedTheme());
}

export function useThemeMode() {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => storedTheme());

  useEffect(() => {
    applyTheme(themeMode);
  }, [themeMode]);

  const setThemeMode = (mode: ThemeMode) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // Ignore storage failures; the active page can still update visually.
    }
    setThemeModeState(mode);
    applyTheme(mode);
  };

  return { themeMode, setThemeMode };
}
