// Live POST /api/restock for a Split against the (Testing) workbooks. Sheets
// only: a Split fills the kitchen's To columns and logs its row, no Nayax.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RESTOCK_LOG_HEADER } from "../../src/lib/restock/config.js";
import {
  clearSheetRange,
  readSheetValues,
  seedSheet,
} from "./support/google-sheets-client.js";

const DATE = "2026-09-07";
const INVENTORY_TAB = "09/07/2026";
const BATCH_ID = `Kitchen-${DATE}`;
const THAI = "Thai Tea 16oz Less Sweet w/ Lychee";
const MATCHA = "Matcha 16oz Less Sweet";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const INVENTORY = () => requireEnv("INVENTORY_SHEET_ID");
const LOG_SHEET = () => requireEnv("RESTOCK_LOG_SHEET_ID");

async function post(body) {
  const { POST } = await import("../../src/pages/api/restock.js");
  const response = await POST({
    request: new Request("https://orble.test/api/restock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "integration-secret",
        batchId: BATCH_ID,
        event: "Split",
        duration: "1m 0s",
        ...body,
      }),
    }),
  });
  return { status: response.status, json: await response.json() };
}

describe("restock split submit, live", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("RESTOCK_SECRET_KEY", "integration-secret");
    vi.stubEnv("INVENTORY_SHEET_ID", INVENTORY());
    vi.stubEnv("RESTOCK_LOG_SHEET_ID", LOG_SHEET());
    vi.stubEnv(
      "GOOGLE_SERVICE_ACCOUNT_EMAIL",
      requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    );
    vi.stubEnv("GOOGLE_PRIVATE_KEY", requireEnv("GOOGLE_PRIVATE_KEY"));
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "");
    // The kitchen's tab carries the To columns; the Split fills them in
    await seedSheet(INVENTORY(), INVENTORY_TAB, [
      ["Drink", "Storage", "To 30th", "To Towne"],
      [THAI, 6],
      [MATCHA, 1],
    ]);
    await seedSheet(LOG_SHEET(), "Restock Log", [
      Object.values(RESTOCK_LOG_HEADER),
    ]);
  });

  afterAll(async () => {
    await clearSheetRange(INVENTORY(), INVENTORY_TAB);
    await clearSheetRange(LOG_SHEET(), "Restock Log");
    vi.unstubAllEnvs();
  });

  it("writes the To columns onto the date's Inventory tab and logs one Complete Split row", async () => {
    const { status, json } = await post({
      drinks: [
        { drink: THAI, to30th: 3, toTowne: 3 },
        { drink: MATCHA, to30th: 1, toTowne: 0 },
      ],
    });

    expect(status).toBe(200);
    expect(json).toMatchObject({ success: true });

    expect(await readSheetValues(INVENTORY(), INVENTORY_TAB)).toEqual([
      ["Drink", "Storage", "To 30th", "To Towne"],
      [THAI, "6", "3", "3"],
      [MATCHA, "1", "1", "0"],
    ]);

    const [header, ...rows] = await readSheetValues(LOG_SHEET(), "Restock Log");
    const log = rows.map((row) =>
      Object.fromEntries(header.map((column, i) => [column, row[i] ?? ""])),
    );
    expect(log).toEqual([
      expect.objectContaining({
        [RESTOCK_LOG_HEADER.BATCH_ID]: BATCH_ID,
        [RESTOCK_LOG_HEADER.EVENT]: "Split",
        [RESTOCK_LOG_HEADER.DURATION]: "1m 0s",
        [RESTOCK_LOG_HEADER.SLOT_DATA]: "",
        [RESTOCK_LOG_HEADER.STATUS]: "Complete",
      }),
    ]);
  });

  it("refuses a drink the Inventory tab does not list, and writes nothing", async () => {
    const { status } = await post({
      drinks: [{ drink: "Horchata 16oz", to30th: 2, toTowne: 0 }],
    });

    expect(status).toBe(400);
    expect(await readSheetValues(INVENTORY(), INVENTORY_TAB)).toEqual([
      ["Drink", "Storage", "To 30th", "To Towne"],
      [THAI, "6"],
      [MATCHA, "1"],
    ]);
    expect(await readSheetValues(LOG_SHEET(), "Restock Log")).toEqual([
      Object.values(RESTOCK_LOG_HEADER),
    ]);
  });
});
