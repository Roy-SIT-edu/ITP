/*
 * Application shell and workflow navigation.
 * Uses the workflow stepper as the main navigation and keeps overview/reference
 * data as secondary utility destinations.
 */

import {
  CalendarClock,
  Gauge,
  Database,
} from "lucide-react";
import { useEffect } from "react";
import type { ReactNode } from "react";
import WorkflowProgress from "./WorkflowProgress";

type Props = {
  route: string;
  onNavigate: (route: string) => void;
  children: ReactNode;
};

const databaseItems = [
  { id: "database-rooms", label: "Rooms" },
  { id: "database-staff", label: "Staff" },
  { id: "database-programmes", label: "Programmes" },
  { id: "database-modules", label: "Modules" },
  { id: "database-student-groups", label: "Student Groups" },
  { id: "database-time-slots", label: "Time Slots" },
];

export default function Layout({ route, onNavigate, children }: Props) {
  useEffect(() => {
    const nav = document.querySelector(".workflow-stepper");
    if (!(nav instanceof HTMLElement)) return;
    const active = nav.querySelector(".workflow-stage.active a");
    if (active instanceof HTMLElement) {
      // Keep the active workflow tab visible on narrow screens.
      active.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  }, [route]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-nav-row">
          <div className="brand">
            <CalendarClock size={24} />
            <div>
              <strong>Timetable</strong>
              <span>Scheduler</span>
            </div>
          </div>
          <div className="nav-area utility-nav">
            <a
              className={route === "dashboard" ? "nav-home active" : "nav-home"}
              href="#dashboard"
              onClick={() => onNavigate("dashboard")}
            >
              <Gauge size={18} />
              <span>Overview</span>
            </a>
            <nav className="nav-list" aria-label="Secondary navigation">
              <div className="nav-dropdown">
                <a
                  className={route.startsWith("database-") ? "active" : ""}
                  href="#database-rooms"
                  onClick={() => onNavigate("database-rooms")}
                >
                  <Database size={18} />
                  <span>Reference Data</span>
                </a>
                <div className="nav-submenu" role="menu">
                  {databaseItems.map((child) => (
                    <a
                      className={route === child.id ? "active" : ""}
                      href={`#${child.id}`}
                      key={child.id}
                      onClick={() => onNavigate(child.id)}
                      role="menuitem"
                    >
                      {child.label}
                    </a>
                  ))}
                </div>
              </div>
            </nav>
          </div>
        </div>
        <WorkflowProgress route={route} onNavigate={onNavigate} />
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
