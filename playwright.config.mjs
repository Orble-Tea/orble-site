// Playwright config for frontend and integration tests.
// The manual live smoke has its own config: playwright.smoke.config.mjs.
import { defineConfig } from "@playwright/test";
import { BACKEND_ENV, PORT } from "./tests/e2e/fixture-server.mjs";

const APP_PORT = 4321;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    // Phone-sized viewport for real layout (restockers use this at the
    // machine), but WITHOUT isMobile/hasTouch emulation: Chromium's mobile
    // emulation offsets tap coordinates by the visual/layout viewport delta
    // (~38px here), making elements near the fixed footer untappable in
    // tests while working fine on real phones.
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  },
  projects: [
    // Browser tests: page.route() intercepts /api/* so only the page is real.
    { name: "browser", testMatch: /mocked\/.*\.spec\.js/ },
    // Integration tests: real API routes + service code; only Nayax/Sheets faked.
    { name: "integration", testMatch: /backend\/.*\.spec\.js/ },
  ],
  webServer: [
    {
      command: "node tests/e2e/fixture-server.mjs",
      url: `http://127.0.0.1:${PORT}/sheets/fixture-log/values/x`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npx astro dev --host 127.0.0.1 --port ${APP_PORT}`,
      url: `http://127.0.0.1:${APP_PORT}/restock?key=test-key`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: BACKEND_ENV,
    },
  ],
});
