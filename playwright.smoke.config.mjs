// @steered AudibleSecurityContext 1.2 2026-09-14
// Config for the MANUAL live smoke test only (layer 4). Deliberately not
// wired into CI: it depends on live Nayax, live Google Sheets, and real
// Production Plan data, and is run by a human who can interpret failures.
// See README "Live smoke test".
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/smoke",
  timeout: 90_000,
  reporter: "list",
  use: {
    baseURL: process.env.SMOKE_URL || "https://orble-tea.com",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  },
});
