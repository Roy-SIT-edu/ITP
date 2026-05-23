import { useEffect, useState } from "react";
import Layout from "./components/Layout";
import DashboardPage from "./pages/DashboardPage";
import ExportPage from "./pages/ExportPage";
import GenerateSchedulePage from "./pages/GenerateSchedulePage";
import RequirementsPage from "./pages/RequirementsPage";
import TimetableReviewPage from "./pages/TimetableReviewPage";
import UploadPage from "./pages/UploadPage";
import ValidationPage from "./pages/ValidationPage";

const routeMap = {
  dashboard: DashboardPage,
  upload: UploadPage,
  validation: ValidationPage,
  requirements: RequirementsPage,
  generate: GenerateSchedulePage,
  review: TimetableReviewPage,
  export: ExportPage,
};

type RouteKey = keyof typeof routeMap;

function currentRoute(): RouteKey {
  const hash = window.location.hash.replace("#", "");
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
