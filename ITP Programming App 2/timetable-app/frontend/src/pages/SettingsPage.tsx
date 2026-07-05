/*
 * Settings page.
 * Keeps general application preferences separate from scheduling workflow rules.
 */

import { Moon, Sun } from "lucide-react";
import { useThemeMode } from "../theme";

export default function SettingsPage() {
  const { themeMode, setThemeMode } = useThemeMode();
  const nightMode = themeMode === "night";

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

      <section className="status-card settings-card">
        <div className="section-heading">
          <div>
            <div className="status-card-title">System Defaults</div>
            <p>Reserved for future global settings such as timezone, landing page, and session timeout defaults.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
