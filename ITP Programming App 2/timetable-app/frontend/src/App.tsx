/*
 * Client-side router for the hash-based single-page app.
 * Maps workflow tabs and database subtabs to their page components.
 */

import { useEffect, useState } from "react";
import DatabasePage from "./pages/DatabasePage";
import Layout from "./components/Layout";
import DashboardPage from "./pages/DashboardPage";
import ExportPage from "./pages/ExportPage";
import TimetableReviewPage from "./pages/TimetableReviewPage";
import UploadPage from "./pages/UploadPage";
import SoftConstraintsPage from "./pages/SoftConstraintsPage";
import SettingsPage from "./pages/SettingsPage";
import PriorityRankingsPage from "./pages/PriorityRankingsPage";

const routeMap = {
  dashboard: DashboardPage,
  "workflow/import": UploadPage,
  "workflow/priority-rankings": PriorityRankingsPage,
  "workflow/generate": SoftConstraintsPage,
  "workflow/review": TimetableReviewPage,
  "workflow/export": ExportPage,
  "database-rooms": () => <DatabasePage dataType="rooms" />,
  "database-staff": () => <DatabasePage dataType="staff" />,
  "database-programmes": () => <DatabasePage dataType="programmes" />,
  "database-modules": () => <DatabasePage dataType="modules" />,
  "database-student-groups": () => <DatabasePage dataType="student-groups" />,
  settings: SettingsPage,
  "settings/general": SettingsPage,
};

type RouteKey = keyof typeof routeMap;

function currentRoute(): RouteKey {
  const hash = window.location.hash.replace("#", "");
  if (hash === "database") return "database-rooms";
  if (hash === "requirements" || hash === "upload") {
    // Old direct links still land on the merged Import + Requirements page.
    window.history.replaceState(null, "", "#workflow/import");
    return "workflow/import";
  }
  if (hash === "settings/priority-rankings" || hash === "priority-rankings") {
    window.history.replaceState(null, "", "#workflow/priority-rankings");
    return "workflow/priority-rankings";
  }
  if (hash === "generate" || hash === "validation" || hash === "soft-constraints") {
    window.history.replaceState(null, "", "#workflow/generate");
    return "workflow/generate";
  }
  if (hash === "review") {
    window.history.replaceState(null, "", "#workflow/review");
    return "workflow/review";
  }
  if (hash === "export") {
    window.history.replaceState(null, "", "#workflow/export");
    return "workflow/export";
  }
  return hash in routeMap ? (hash as RouteKey) : "dashboard";
}

export default function App() {
  const [route, setRoute] = useState<RouteKey>(currentRoute());
  const Page = routeMap[route];

  useEffect(() => {
    const handleHashChange = () => setRoute(currentRoute());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const navigate = (nextRoute: string) => {
    if (nextRoute in routeMap) {
      setRoute(nextRoute as RouteKey);
    }
  };

  return (
    <Layout route={route} onNavigate={navigate}>
      <Page />
    </Layout>
  );
}
