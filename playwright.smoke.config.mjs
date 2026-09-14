// Excluded from CI, use with caution for smoke tests as they work on
// production data. See README "Live smoke test".
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
