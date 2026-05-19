import {
  CalendarClock,
  Download,
  Gauge,
  TableProperties,
  Upload,
  WandSparkles,
  CheckCircle2,
} from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  route: string;
  onNavigate: (route: string) => void;
  children: ReactNode;
};

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: Gauge },
  { id: "upload", label: "Upload", icon: Upload },
  { id: "validation", label: "Validation", icon: CheckCircle2 },
  { id: "generate", label: "Generate", icon: WandSparkles },
  { id: "review", label: "Review", icon: TableProperties },
  { id: "export", label: "Export", icon: Download },
];

export default function Layout({ route, onNavigate, children }: Props) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <CalendarClock size={24} />
          <div>
            <strong>Timetable</strong>
            <span>Scheduler</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="Primary">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <a
                className={route === item.id ? "active" : ""}
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
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
