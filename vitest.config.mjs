import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Playwright owns tests/e2e and tests/smoke; vitest must not collect
    // their .spec.js files (its default include matches them).
    exclude: [
      "**/node_modules/**",
      "tests/e2e/**",
      "tests/smoke/**",
      "tests/integration/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: [
        "src/lib/restock/**/*.js",
        "src/pages/api/restock-data.js",
        "src/pages/api/restock-submit.js",
      ],
      exclude: ["**/*.test.js"],
    },
  },
});
