/// <reference types="vitest" />
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig, searchForWorkspaceRoot, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { deskFixture } from "./src/fixtures/desk/index";

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

/** Dev-only Desk v2 fixtures (DESK_FRAME3_SPEC §13): with DESK_FIXTURES=1 the
 * dev server answers /api/desk/* from web/src/fixtures/desk/ (the same
 * resolver the Desk browser tests use) before the API proxy sees the request.
 * Off by default, and never part of `vite build`: the app itself always asks
 * the API. */
function deskFixturesPlugin(): Plugin {
  return {
    name: "mrr-desk-fixtures",
    apply: "serve",
    configureServer(server) {
      if (process.env.DESK_FIXTURES !== "1") return;
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/desk")) return next();
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          const body = chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined;
          const reply = deskFixture(req.method ?? "GET", req.url ?? "", body, String(req.headers.accept ?? ""));
          if (!reply) return next();
          res.statusCode = reply.status;
          res.setHeader("content-type", reply.contentType);
          res.end(reply.body);
        });
      });
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
  plugins: [react(), buildStampPlugin(), deskFixturesPlugin()],
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
    // Build Notes renders docs/desk/BUILD_NOTES.md (DESK_FRAME3_SPEC §11), outside web/:
    // the dev server may read that one file besides its own root.
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), fileURLToPath(new URL("../docs/desk/BUILD_NOTES.md", import.meta.url))] },
    proxy: {
      // ws: true upgrades /api/stream/ws to the FastAPI relay alongside plain GETs.
      "/api": { target: API_TARGET, changeOrigin: true, ws: true },
      "/health": { target: API_TARGET, changeOrigin: true },
      // Unprefixed latest-snapshot endpoints (Atlas contract) — /series/{id}/latest
      "/series": { target: API_TARGET, changeOrigin: true },
    },
  },
});
