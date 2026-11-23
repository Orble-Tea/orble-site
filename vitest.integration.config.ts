import { defineConfig } from "vitest/config";
import dotenv from "dotenv";

const INTEGRATION_TIMEOUT_MS = 120000;

dotenv.config({ path: ".env.integration" });

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.js"],
    globals: true,
    testTimeout: INTEGRATION_TIMEOUT_MS,
    hookTimeout: INTEGRATION_TIMEOUT_MS,
    fileParallelism: false,
  },
});
