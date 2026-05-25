import { useEffect, useState } from "react";
import DatabasePage from "./pages/DatabasePage";
import Layout from "./components/Layout";
import DashboardPage from "./pages/DashboardPage";
import ExportPage from "./pages/ExportPage";
import GenerateSchedulePage from "./pages/GenerateSchedulePage";
import TimetableReviewPage from "./pages/TimetableReviewPage";
import UploadPage from "./pages/UploadPage";
import ValidationPage from "./pages/ValidationPage";

const routeMap = {
  dashboard: DashboardPage,
  upload: UploadPage,
  "database-rooms": () => <DatabasePage dataType="rooms" />,
  "database-staff": () => <DatabasePage dataType="staff" />,
  "database-programmes": () => <DatabasePage dataType="programmes" />,
  "database-modules": () => <DatabasePage dataType="modules" />,
  "database-student-groups": () => <DatabasePage dataType="student-groups" />,
  "database-time-slots": () => <DatabasePage dataType="time-slots" />,
  validation: ValidationPage,
  generate: GenerateSchedulePage,
  review: TimetableReviewPage,
  export: ExportPage,
};

type RouteKey = keyof typeof routeMap;

function currentRoute(): RouteKey {
  const hash = window.location.hash.replace("#", "");
  if (hash === "database") return "database-rooms";
  if (hash === "requirements") {
    window.history.replaceState(null, "", "#upload");
    return "upload";
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
