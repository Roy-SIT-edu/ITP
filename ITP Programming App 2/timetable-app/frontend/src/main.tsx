/*
 * React entrypoint.
 * Mounts the single-page timetable application into the Vite root element.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initializeTheme } from "./theme";
import "./styles.css";

initializeTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
