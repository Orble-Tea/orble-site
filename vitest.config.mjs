import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    exclude: ["node_modules/**", "tests/integration/**"],
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: [
        "src/lib/restock/**/*.js",
        "src/lib/label-printer/production-plan.js",
        "src/pages/api/restock-data.js",
        "src/pages/api/label-print-data.js",
        "src/pages/api/restock-submit.js",
      ],
      exclude: ["**/*.test.js"],
    },
  },
});
