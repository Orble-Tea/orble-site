import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
});

// Read-only: never seed or clear the production workbook, and never access USB.
it("loads the configured Google Sheet through the label API", async () => {
  vi.stubEnv("RESTOCK_SECRET_KEY", "integration-test-key");
  const { GET } = await import("../../src/pages/api/label-print-data.js");
  const response = await GET({
    url: new URL(
      "https://orble.test/api/label-print-data?key=integration-test-key",
    ),
  });
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(Array.isArray(data.rows)).toBe(true);
  for (const row of data.rows) {
    expect(row.drinkName).toBeTruthy();
    expect(row.labels.length).toBe(
      row.directLabels + row.storageLabels + row.spareLabels,
    );
    expect(row.spareLabels).toBe(1);
    expect(row.labels.every((label) => label.drinkName === row.drinkName)).toBe(
      true,
    );
    expect(
      row.labels.every((label) =>
        /^\d{2}\/\d{2}\/\d{2}$/.test(label.expirationDate),
      ),
    ).toBe(true);
  }
});
