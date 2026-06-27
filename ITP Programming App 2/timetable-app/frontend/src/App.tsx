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

const routeMap = {
  dashboard: DashboardPage,
  upload: UploadPage,
  "database-rooms": () => <DatabasePage dataType="rooms" />,
  "database-staff": () => <DatabasePage dataType="staff" />,
  "database-programmes": () => <DatabasePage dataType="programmes" />,
  "database-modules": () => <DatabasePage dataType="modules" />,
  "database-student-groups": () => <DatabasePage dataType="student-groups" />,
  "soft-constraints": SoftConstraintsPage,
  review: TimetableReviewPage,
  export: ExportPage,
};

type RouteKey = keyof typeof routeMap;

function currentRoute(): RouteKey {
  const hash = window.location.hash.replace("#", "");
  if (hash === "database") return "database-rooms";
  if (hash === "requirements") {
    // Old direct links still land on the merged Import + Requirements page.
    window.history.replaceState(null, "", "#upload");
    return "upload";
  }
  if (hash === "generate") {
    window.history.replaceState(null, "", "#soft-constraints");
    return "soft-constraints";
  }
  if (hash === "validation") {
    window.history.replaceState(null, "", "#soft-constraints");
    return "soft-constraints";
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
