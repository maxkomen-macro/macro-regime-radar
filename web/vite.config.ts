import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev-time proxy: the FastAPI service (uvicorn api.main:app --port 8000) is
// reached same-origin via /api and the unprefixed /health, matching the
// production plan where FastAPI serves the built bundle from one process.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // ws: true upgrades /api/stream/ws to the FastAPI relay alongside plain GETs.
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true, ws: true },
      "/health": { target: "http://127.0.0.1:8000", changeOrigin: true },
      // Unprefixed latest-snapshot endpoints (Atlas contract) — /series/{id}/latest
      "/series": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
});
