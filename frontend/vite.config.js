import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Multi-user PINJ: normally the hub serves the built pages on :8080 (START_PINJ.bat).
// `npm run dev` (port 7080) is only for editing the frontend: every PINJ call goes through
// this proxy to the hub on :8080, so the page and the sign-in cookie share one address.
// Ports 8080/7080 keep this copy apart from the WSL PINJ on 8000/7000.
const HUB = "http://localhost:8080";
const ROUTES = ["/hub", "/health", "/api", "/decode", "/diff", "/ingest", "/live/", "/spec", "/stats", "/svk",
                "/upload", "/validate"];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 7080,
    proxy: {
      ...Object.fromEntries(ROUTES.map(r => [r, { target: HUB, changeOrigin: false }])),
      "/ws": { target: HUB.replace("http", "ws"), ws: true, changeOrigin: false },
    },
  },
});
