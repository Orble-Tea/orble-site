import { defineConfig } from "vitest/config";
import dotenv from "dotenv";

dotenv.config({ path: ".env.integration" });

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.js"],
    globals: true,
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
