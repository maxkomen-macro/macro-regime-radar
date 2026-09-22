/**
 * Playwright e2e config (redesign-v2, Phase 0). Runs against the local Vite
 * dev server on :5173 (proxying the API on :8000). Never starts servers.
 * Specs live in e2e/; vitest ignores them (its include is src/**).
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  outputDir: "./test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    viewport: { width: 1672, height: 941 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    headless: true,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
