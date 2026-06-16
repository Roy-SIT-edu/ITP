/*
 * Application shell and workflow navigation.
 * Uses the workflow stepper as the main navigation and keeps overview/reference
 * data as secondary utility destinations.
 */

import {
  CalendarClock,
  Database,
  Download,
  FileUp,
  Gauge,
  ShieldCheck,
  SlidersHorizontal,
  TableProperties,
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
];

const workflowItems = [
  { id: "upload", label: "Import Data", icon: FileUp },
  { id: "validation", label: "Validate Data", icon: ShieldCheck },
  { id: "soft-constraints", label: "Priorities & Generate", icon: SlidersHorizontal },
  { id: "review", label: "Review Timetable", icon: TableProperties },
  { id: "export", label: "Export Timetable", icon: Download },
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
      <aside className="sidebar" aria-label="Application navigation">
        <div className="brand">
          <CalendarClock size={24} />
          <div>
            <strong>Timetable</strong>
            <span>Scheduler</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          <a
            className={route === "dashboard" ? "sidebar-link active" : "sidebar-link"}
            href="#dashboard"
            onClick={() => onNavigate("dashboard")}
          >
            <Gauge size={18} />
            <span>Overview</span>
          </a>
          <div className="sidebar-nav-group">
            <span className="sidebar-nav-label">Workflow</span>
            {workflowItems.map((item) => {
              const Icon = item.icon;
              return (
                <a
                  className={route === item.id ? "sidebar-link active" : "sidebar-link"}
                  href={`#${item.id}`}
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </a>
              );
            })}
          </div>
          <div className="sidebar-nav-group">
            <span className="sidebar-nav-label">Reference Data</span>
            {databaseItems.map((child) => (
              <a
                className={route === child.id ? "sidebar-link active" : "sidebar-link"}
                href={`#${child.id}`}
                key={child.id}
                onClick={() => onNavigate(child.id)}
              >
                <Database size={18} />
                <span>{child.label}</span>
              </a>
            ))}
          </div>
        </nav>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <WorkflowProgress route={route} onNavigate={onNavigate} />
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
