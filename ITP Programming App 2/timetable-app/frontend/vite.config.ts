import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_PROXY_TARGET || "http://localhost:8000";
  const appRoot = process.cwd();

  return {
    plugins: [
      react(),
      {
        name: "timetable-frontend-health",
        configureServer(server) {
          server.middlewares.use("/frontend-health", (_request, response) => {
            response.statusCode = 200;
            response.setHeader("Content-Type", "application/json");
            response.setHeader("Cache-Control", "no-store");
            response.end(
              JSON.stringify({
                status: "ok",
                app_root: appRoot,
                node_env: process.env.NODE_ENV ?? null,
              }),
            );
          });
        },
      },
    ],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
        },
        "/health": {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
