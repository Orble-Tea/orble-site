import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e/mocked",
  testMatch: "label-printer.spec.js",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://127.0.0.1:4337", browserName: "chromium" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "npx astro dev --host 127.0.0.1 --port 4337",
    url: "http://127.0.0.1:4337/label-printer?key=test-key",
    env: { RESTOCK_SECRET_KEY: "test-key" },
    timeout: 120000,
    reuseExistingServer: false,
  },
});
