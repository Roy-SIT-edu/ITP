/*
 * Settings page.
 * Keeps general application preferences separate from scheduling workflow rules.
 */

import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { useThemeMode } from "../theme";

const termOptions = ["AY2026/27 Trimester 1", "AY2026/27 Trimester 2", "AY2026/27 Trimester 3"];
const slotDurationOptions = [
  { label: "1 hour", value: "1" },
  { label: "1.5 hours", value: "1.5" },
  { label: "2 hours", value: "2" },
  { label: "3 hours", value: "3" },
];
const continuousTeachingOptions = [
  { label: "2 hours", value: "2" },
  { label: "3 hours", value: "3" },
  { label: "4 hours", value: "4" },
  { label: "5 hours", value: "5" },
];
const landingPageOptions = [
  { label: "Overview", value: "dashboard" },
  { label: "Import Data", value: "workflow/import" },
  { label: "Priority Rankings", value: "workflow/priority-rankings" },
  { label: "Generate Timetable", value: "workflow/generate" },
];
const timezoneOptions = ["UTC+08:00 (Singapore Standard Time)", "UTC+00:00", "UTC+07:00", "UTC+09:00"];

function readStoredSetting(key: string, fallback: string) {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function useStoredSetting(key: string, fallback: string) {
  const [value, setValueState] = useState(() => readStoredSetting(key, fallback));

  const setValue = (nextValue: string) => {
    try {
      window.localStorage.setItem(key, nextValue);
    } catch {
      // The setting still updates for the active page even if storage is blocked.
    }
    setValueState(nextValue);
  };

  return [value, setValue] as const;
}

export default function SettingsPage() {
  const { themeMode, setThemeMode } = useThemeMode();
  const nightMode = themeMode === "night";
  const [activeTerm, setActiveTerm] = useStoredSetting("timetable.activeTerm", "AY2026/27 Trimester 1");
  const [operatingStart, setOperatingStart] = useStoredSetting("timetable.operatingStart", "08:30");
  const [operatingEnd, setOperatingEnd] = useStoredSetting("timetable.operatingEnd", "18:30");
  const [baseSlotDuration, setBaseSlotDuration] = useStoredSetting("timetable.baseSlotDuration", "2");
  const [travelBuffer, setTravelBuffer] = useStoredSetting("timetable.travelBufferMinutes", "15");
  const [maxDailyHours, setMaxDailyHours] = useStoredSetting("timetable.maxDailyContactHours", "8");
  const [maxContinuousTeaching, setMaxContinuousTeaching] = useStoredSetting("timetable.maxContinuousTeachingHours", "4");
  const [solverTimeout, setSolverTimeout] = useStoredSetting("timetable.solverTimeoutSeconds", "300");
  const [defaultLandingPage, setDefaultLandingPage] = useStoredSetting("timetable.defaultLandingPage", "dashboard");
  const [systemTimezone, setSystemTimezone] = useStoredSetting(
    "timetable.systemTimezone",
    "UTC+08:00 (Singapore Standard Time)",
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>General Settings</h1>
          <p>Configure application-wide preferences and defaults.</p>
        </div>
      </div>

      <section className="status-card settings-card appearance-card">
        <div className="section-heading">
          <div>
            <div className="status-card-title">Appearance</div>
            <p>Choose the interface brightness for this device</p>
          </div>
          <label className="theme-toggle">
            <input
              checked={nightMode}
              type="checkbox"
              onChange={(event) => setThemeMode(event.target.checked ? "night" : "light")}
            />
            <span className="theme-toggle-track" aria-hidden="true">
              <span className="theme-toggle-thumb">{nightMode ? <Moon size={15} /> : <Sun size={15} />}</span>
            </span>
            <span className="theme-toggle-label">{nightMode ? "Night mode" : "Day mode"}</span>
          </label>
        </div>
      </section>

      <div className="section-heading settings-section-heading">
        <div>
          <h2>System Defaults</h2>
          <p>Set the academic, time, constraint, and interface defaults used by this browser session.</p>
        </div>
      </div>

      <section className="status-card settings-card settings-default-card">
        <div className="settings-block-heading">
          <div>
            <div className="status-card-title">Active Academic Term Scope</div>
            <p>Choose the academic term for imported timetable rows.</p>
          </div>
        </div>
        <div className="settings-field-grid single">
          <label className="settings-field">
            <span>Active Term</span>
            <select value={activeTerm} onChange={(event) => setActiveTerm(event.target.value)}>
              {termOptions.map((term) => (
                <option key={term} value={term}>
                  {term}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="status-card settings-card settings-default-card">
        <div className="settings-block-heading">
          <div>
            <div className="status-card-title">Time Boundaries & Buffer Rules</div>
            <p>Define operating-hour limits, baseline slot duration, and transition buffers.</p>
          </div>
        </div>
        <div className="settings-field-grid">
          <label className="settings-field">
            <span>Start Time</span>
            <input type="time" value={operatingStart} onChange={(event) => setOperatingStart(event.target.value)} />
          </label>
          <label className="settings-field">
            <span>End Time</span>
            <input type="time" value={operatingEnd} onChange={(event) => setOperatingEnd(event.target.value)} />
          </label>
          <label className="settings-field">
            <span>Base Slot Duration</span>
            <select value={baseSlotDuration} onChange={(event) => setBaseSlotDuration(event.target.value)}>
              {slotDurationOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            <span>Campus Travel / Intermission Buffer</span>
            <input
              min="0"
              step="5"
              type="number"
              value={travelBuffer}
              onChange={(event) => setTravelBuffer(event.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="status-card settings-card settings-default-card">
        <div className="settings-block-heading">
          <div>
            <div className="status-card-title">Institutional Constraints</div>
            <p>Set hard-cap defaults for daily contact load and continuous teaching blocks.</p>
          </div>
        </div>
        <div className="settings-field-grid">
          <label className="settings-field">
            <span>Maximum Student Daily Contact Hours</span>
            <input
              min="1"
              step="1"
              type="number"
              value={maxDailyHours}
              onChange={(event) => setMaxDailyHours(event.target.value)}
            />
          </label>
          <label className="settings-field">
            <span>Maximum Continuous Teaching Limit</span>
            <select value={maxContinuousTeaching} onChange={(event) => setMaxContinuousTeaching(event.target.value)}>
              {continuousTeachingOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="status-card settings-card settings-default-card">
        <div className="settings-block-heading">
          <div>
            <div className="status-card-title">Solver Engine & UI Controls</div>
            <p>Manage optimization runtime and default interface preferences.</p>
          </div>
        </div>
        <div className="settings-field-grid">
          <label className="settings-field">
            <span>Solver Timeout Threshold</span>
            <input
              min="30"
              step="30"
              type="number"
              value={solverTimeout}
              onChange={(event) => setSolverTimeout(event.target.value)}
            />
          </label>
          <label className="settings-field">
            <span>Default Landing Page</span>
            <select value={defaultLandingPage} onChange={(event) => setDefaultLandingPage(event.target.value)}>
              {landingPageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            <span>System Timezone</span>
            <select value={systemTimezone} onChange={(event) => setSystemTimezone(event.target.value)}>
              {timezoneOptions.map((timezone) => (
                <option key={timezone} value={timezone}>
                  {timezone}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
    </div>
  );
}
