/// <reference types="vitest" />
import { execSync } from "node:child_process";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function git(args: string): string {
  try {
    return execSync(`git ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

/** Dev-only build stamp (redesign brief, Phase 1): <meta name="mrr-build"
 * content="<branch>@<sha7>">, computed once when the dev server starts, so a
 * verifier reading it in the browser knows which checkout the page came from.
 * Restart Vite after every branch cut or commit. Never emitted by `vite build`. */
function buildStampPlugin(): Plugin {
  const stamp = `${git("rev-parse --abbrev-ref HEAD")}@${git("rev-parse --short=7 HEAD")}`;
  return {
    name: "mrr-build-stamp",
    apply: "serve",
    transformIndexHtml() {
      return [{ tag: "meta", attrs: { name: "mrr-build", content: stamp }, injectTo: "head" }];
    },
  };
}

// Where the dev server proxies the API. Defaults to the local uvicorn; set
// VITE_PROXY_TARGET to point a dev or e2e run at another one (a container, a
// second port), which is how the launch-1 rehearsal runs.
const API_TARGET = process.env.VITE_PROXY_TARGET ?? "http://127.0.0.1:8000";

// Dev-time proxy: the FastAPI service (uvicorn api.main:app --port 8000) is
// reached same-origin via /api and the unprefixed /health, matching the
// production plan where FastAPI serves the built bundle from one process.
export default defineConfig({
  plugins: [react(), buildStampPlugin()],
  define: {
    // Sidebar footer version: npm sets npm_package_version for `npm run dev/build`.
    __MRR_VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.0.0"),
  },
  build: {
    // Route-level code splitting (2026-09-06): each screen is a React.lazy
    // chunk; the chart library and React Query get their own vendor chunks
    // so a screen change never re-downloads the shell.
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-query": ["@tanstack/react-query"],
          "vendor-charts": ["lightweight-charts"],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // ws: true upgrades /api/stream/ws to the FastAPI relay alongside plain GETs.
      "/api": { target: API_TARGET, changeOrigin: true, ws: true },
      "/health": { target: API_TARGET, changeOrigin: true },
      // Unprefixed latest-snapshot endpoints (Atlas contract) — /series/{id}/latest
      "/series": { target: API_TARGET, changeOrigin: true },
    },
  },
});
