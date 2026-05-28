/*
 * Application shell and workflow navigation.
 * Keeps Dashboard always visible and exposes Database subtabs through the
 * horizontal navbar dropdown.
 */

import {
  CalendarClock,
  Download,
  Gauge,
  Database,
  TableProperties,
  Upload,
  CheckCircle2,
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

const workflowItems = [
  { id: "upload", label: "Import", icon: Upload },
  { id: "validation", label: "Validate", icon: CheckCircle2 },
  { id: "review", label: "Review", icon: TableProperties },
  { id: "export", label: "Export", icon: Download },
  { id: "database", label: "Database", icon: Database, children: databaseItems },
];

export default function Layout({ route, onNavigate, children }: Props) {
  useEffect(() => {
    const nav = document.querySelector(".nav-list");
    if (!(nav instanceof HTMLElement)) return;
    if (route === "dashboard") {
      nav.scrollTo({ left: 0, behavior: "smooth" });
      return;
    }
    const active = nav.querySelector("a.active");
    if (active instanceof HTMLElement) {
      // Keep the active workflow tab visible on narrow screens.
      active.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  }, [route]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <WorkflowProgress route={route} />
        <div className="topbar-nav-row">
          <div className="brand">
            <CalendarClock size={24} />
            <div>
              <strong>Timetable</strong>
              <span>Scheduler</span>
            </div>
          </div>
          <div className="nav-area">
            <a
              className={route === "dashboard" ? "nav-home active" : "nav-home"}
              href="#dashboard"
              onClick={() => onNavigate("dashboard")}
            >
              <Gauge size={18} />
              <span>Dashboard</span>
            </a>
            <nav className="nav-list" aria-label="Workflow">
              {workflowItems.map((item) => {
                const Icon = item.icon;
                const active = item.children ? route.startsWith("database-") : route === item.id;
                if (item.children) {
                  return (
                    <div className="nav-dropdown" key={item.id}>
                      <a
                        className={active ? "active" : ""}
                        href="#database-rooms"
                        onClick={() => onNavigate("database-rooms")}
                      >
                        <Icon size={18} />
                        <span>{item.label}</span>
                      </a>
                      <div className="nav-submenu" role="menu">
                        {item.children.map((child) => (
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
                  );
                }
                return (
                  <a
                    className={active ? "active" : ""}
                    href={`#${item.id}`}
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </a>
                );
              })}
            </nav>
          </div>
        </div>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
