import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: [
        "src/lib/restock/**/*.js",
        "src/pages/api/{picklist,restock-data,restock-submit}.js",
      ],
      exclude: ["**/*.test.js"],
      reporter: ["text"],
    },
  },
});
