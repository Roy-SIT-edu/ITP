/*
 * Application shell and workflow navigation.
 * Uses the workflow stepper as the main navigation and keeps overview/reference
 * data as secondary utility destinations.
 */

import {
  CalendarClock,
  ChevronDown,
  Database,
  Download,
  FileUp,
  Gauge,
  Settings as SettingsIcon,
  SlidersHorizontal,
  TableProperties,
} from "lucide-react";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { useSessionState } from "../sessionState";
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
  { id: "database-lab-requirements", label: "Lab Requirements" },
];

const workflowItems = [
  { id: "upload", label: "Import Data", icon: FileUp },
  { id: "soft-constraints", label: "Generate Timetable", icon: SlidersHorizontal },
  { id: "review", label: "Review Timetable", icon: TableProperties },
  { id: "export", label: "Export Timetable", icon: Download },
];

export default function Layout({ route, onNavigate, children }: Props) {
  const [workflowOpen, setWorkflowOpen] = useSessionState("sidebar.workflowOpen", true);
  const [referenceOpen, setReferenceOpen] = useSessionState("sidebar.referenceOpen", false);

  useEffect(() => {
    const nav = document.querySelector(".workflow-stepper");
    if (!(nav instanceof HTMLElement)) return;
    const active = nav.querySelector(".workflow-stage.active a");
    if (active instanceof HTMLElement) {
      // Keep the active workflow tab visible on narrow screens.
      active.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  }, [route]);

  useEffect(() => {
    if (workflowItems.some((item) => item.id === route)) {
      setWorkflowOpen(true);
    }
    if (databaseItems.some((item) => item.id === route)) {
      setReferenceOpen(true);
    }
  }, [route, setReferenceOpen, setWorkflowOpen]);

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
          <a
            className={route === "settings" ? "sidebar-link active" : "sidebar-link"}
            href="#settings"
            onClick={() => onNavigate("settings")}
          >
            <SettingsIcon size={18} />
            <span>Settings</span>
          </a>
          <div className="sidebar-nav-group">
            <button
              aria-controls="sidebar-workflow-links"
              aria-expanded={workflowOpen}
              className="sidebar-group-toggle"
              onClick={() => setWorkflowOpen((current) => !current)}
              type="button"
            >
              <span>Workflow</span>
              <ChevronDown className={workflowOpen ? "open" : ""} size={15} />
            </button>
            <div className="sidebar-group-content" hidden={!workflowOpen} id="sidebar-workflow-links">
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
          </div>
          <div className="sidebar-nav-group">
            <button
              aria-controls="sidebar-reference-links"
              aria-expanded={referenceOpen}
              className="sidebar-group-toggle"
              onClick={() => setReferenceOpen((current) => !current)}
              type="button"
            >
              <span>Reference Data</span>
              <ChevronDown className={referenceOpen ? "open" : ""} size={15} />
            </button>
            <div className="sidebar-group-content" hidden={!referenceOpen} id="sidebar-reference-links">
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
