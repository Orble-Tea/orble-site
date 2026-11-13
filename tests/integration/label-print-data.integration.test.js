import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { seedSheet, clearSheetRange } from "./support/google-sheets-client.js";

const SHEET_NAME = "Production Plan";
let seeded = false;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("RESTOCK_SECRET_KEY", "integration-test-key");
  vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "");
});

afterEach(async () => {
  try {
    if (seeded)
      await clearSheetRange(process.env.PRODUCTION_PLAN_SHEET_ID, SHEET_NAME);
  } finally {
    seeded = false;
    vi.unstubAllEnvs();
  }
});

it("loads seeded machine slots, storage, and backup labels through the real API", async () => {
  const sheetId = process.env.PRODUCTION_PLAN_SHEET_ID;
  if (!sheetId)
    throw new Error(
      "Missing required environment variable: PRODUCTION_PLAN_SHEET_ID",
    );
  seeded = true;
  await seedSheet(sheetId, SHEET_NAME, [
    [
      "Drink Variation",
      "Amount to Make",
      "Amount to 30TH",
      "Slot (30TH)",
      "Amount to Towne",
      "Slot (Towne)",
    ],
    ["Matcha 16oz", 1, 2, "1, 2", 2, "14, 15"],
    ["Thai Tea 16oz", 3, 1, "21", 0, ""],
  ]);
  const { GET } = await import("../../src/pages/api/label-print-data.js");
  const response = await GET({
    url: new URL(
      "https://orble.test/api/label-print-data?key=integration-test-key",
    ),
  });
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.rows).toHaveLength(2);
  expect(data.validationErrors).toEqual([
    { drinkName: "Matcha 16oz", amountToMake: 1, machineAmount: 4 },
  ]);
  expect(data.rows[0]).toMatchObject({
    drinkName: "Matcha 16oz",
    directLabels: 4,
    storageLabels: 0,
    spareLabels: 1,
  });
  expect(data.rows[0].labels.map(({ code }) => code)).toEqual([
    "30TH#1,2",
    "30TH#1,2",
    "TWNE#14,15",
    "TWNE#14,15",
    "",
  ]);
  expect(data.rows[1]).toMatchObject({
    drinkName: "Thai Tea 16oz",
    directLabels: 1,
    storageLabels: 2,
    spareLabels: 1,
  });
  expect(data.rows[1].labels.map(({ code }) => code)).toEqual([
    "30TH#21",
    "",
    "",
    "",
  ]);
  const expiration = new Date();
  expiration.setUTCDate(expiration.getUTCDate() + 7);
  const expectedExpiration = expiration.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
  });
  for (const row of data.rows) {
    expect(
      row.labels.every(
        (label) =>
          label.drinkName === row.drinkName &&
          label.expirationDate === expectedExpiration,
      ),
    ).toBe(true);
  }
});
