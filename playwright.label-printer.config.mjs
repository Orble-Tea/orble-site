import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e/mocked",
  testMatch: "label-printer.spec.js",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  globalSetup: "./tests/e2e/label-printer-setup.mjs",
  use: { browserName: "chromium" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
});
