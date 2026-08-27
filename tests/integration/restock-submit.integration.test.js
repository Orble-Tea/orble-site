import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearLatestSheet,
  clearSheetRange,
  readSheetValues,
  seedLatestSheet,
  seedSheet,
} from "./support/google-sheets-client.js";

const TEST_DATE = "2026-09-01";
const BATCH_ID = `30TH-${TEST_DATE}`;
const RESTOCK_LOG_HEADER = [
  [
    "Batch ID",
    "Event",
    "Date",
    "Slot",
    "Drink",
    "Previous",
    "Waste",
    "New",
    "Total",
    "Expected",
  ],
];
const VISITS_HEADER = [["Batch ID", "Visit Date", "Duration"]];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function jsonRequest(body) {
  return new Request("https://orble.test/api/restock-submit", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function seedRestockLog(rows = RESTOCK_LOG_HEADER) {
  await seedSheet(requireEnv("RESTOCK_LOG_SHEET_ID"), "Restock Log", rows);
}

async function seedVisits(rows = VISITS_HEADER) {
  await seedSheet(requireEnv("RESTOCK_LOG_SHEET_ID"), "Visits", rows);
}

async function seedProductionPlan(rows) {
  await seedSheet(
    requireEnv("PRODUCTION_PLAN_SHEET_ID"),
    "Production Plan",
    rows,
  );
}

async function seedInventory(rows) {
  return seedLatestSheet(requireEnv("INVENTORY_SHEET_ID"), rows);
}

describe("restock submit integration", () => {
  const realFetch = globalThis.fetch.bind(globalThis);

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("RESTOCK_SECRET_KEY", "integration-secret");
    vi.stubEnv("NAYAX_MACHINE_30TH_ID", "machine-1");
    vi.stubEnv(
      "PRODUCTION_PLAN_SHEET_ID",
      requireEnv("PRODUCTION_PLAN_SHEET_ID"),
    );
    vi.stubEnv("INVENTORY_SHEET_ID", requireEnv("INVENTORY_SHEET_ID"));
    vi.stubEnv("RESTOCK_LOG_SHEET_ID", requireEnv("RESTOCK_LOG_SHEET_ID"));
    vi.stubEnv(
      "GOOGLE_SERVICE_ACCOUNT_EMAIL",
      requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    );
    vi.stubEnv("GOOGLE_PRIVATE_KEY", requireEnv("GOOGLE_PRIVATE_KEY"));
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "");
    vi.stubEnv("NAYAX_API_TOKEN", "nayax-token");
    vi.stubEnv("SLACK_RESTOCK_WEBHOOK_URL", "");
    vi.stubEnv("SLACK_WEBHOOK_URL", "");
  });

  afterEach(async () => {
    await clearSheetRange(
      requireEnv("PRODUCTION_PLAN_SHEET_ID"),
      "Production Plan",
    );
    await clearSheetRange(requireEnv("RESTOCK_LOG_SHEET_ID"), "Restock Log");
    await clearSheetRange(requireEnv("RESTOCK_LOG_SHEET_ID"), "Visits");
    await clearLatestSheet(requireEnv("INVENTORY_SHEET_ID"));
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    await seedRestockLog();
    await seedVisits();
  });

  it("submits a Load to Nayax and writes Clearout, Load, and Visit rows", async () => {
    await seedProductionPlan([
      [
        "Drink Variation",
        "Amount to 30TH",
        "Slot (30TH)",
        "NayaxProductID",
        "CashPrice",
        "CreditCardPrice",
      ],
      ["Thai Tea Less Sweet w/ Lychee 16oz", 4, "1", "np-new", 6, 6.5],
    ]);
    await clearLatestSheet(requireEnv("INVENTORY_SHEET_ID"));

    let nayaxPutBody;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (url, options = {}) => {
        const urlText = String(url);
        const method = options.method || "GET";
        if (
          urlText.startsWith("https://oauth2.googleapis.com/") ||
          urlText.startsWith("https://sheets.googleapis.com/")
        ) {
          return realFetch(url, options);
        }
        if (urlText.includes("machineProducts") && method === "PUT") {
          nayaxPutBody = JSON.parse(options.body);
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlText.includes("machineProducts")) {
          return new Response(
            JSON.stringify([
              {
                MachineProductID: "mp-1",
                NayaxProductID: "np-old",
                MDBCode: 1,
                PAR: 4,
                MissingStockByMDB: 2,
                DEXProductName: "Taro Normal 16oz",
              },
            ]),
            { headers: { "Content-Type": "application/json" } },
          );
        }
        throw new Error(`Unexpected URL: ${urlText}`);
      },
    );

    const { POST } = await import("../../src/pages/api/restock-submit.js");
    const response = await POST({
      request: jsonRequest({
        key: "integration-secret",
        batchId: BATCH_ID,
        event: "Load",
        machine: "30TH",
        date: TEST_DATE,
        duration: "5m 32s",
        slots: [{ slot: 1, waste: 2, new: 4 }],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: "Restock complete",
    });
    expect(nayaxPutBody).toEqual([
      {
        MachineProductID: "mp-1",
        NayaxProductID: "np-new",
        MachineID: "machine-1",
        MDBCode: 1,
        PAR: 4,
        DEXProductName: "Thai Tea Less Sweet w/ Lychee 16oz",
      },
    ]);

    const logRows = await readSheetValues(
      requireEnv("RESTOCK_LOG_SHEET_ID"),
      "Restock Log",
      "A1:J3",
    );
    expect(logRows).toEqual([
      RESTOCK_LOG_HEADER[0],
      [
        BATCH_ID,
        "Clearout",
        TEST_DATE,
        "1",
        "Thai Tea Less Sweet w/ Lychee 16oz",
        "2",
        "2",
        "0",
        "0",
        "0",
      ],
      [
        BATCH_ID,
        "Load",
        TEST_DATE,
        "1",
        "Thai Tea Less Sweet w/ Lychee 16oz",
        "0",
        "0",
        "4",
        "4",
        "4",
      ],
    ]);

    const visitRows = await readSheetValues(
      requireEnv("RESTOCK_LOG_SHEET_ID"),
      "Visits",
      "A1:C2",
    );
    expect(visitRows).toEqual([
      VISITS_HEADER[0],
      [BATCH_ID, TEST_DATE, "5m 32s"],
    ]);
  });

  it("submits a Topoff, writes one log row, updates Nayax, and clears storage", async () => {
    await seedRestockLog([
      ...RESTOCK_LOG_HEADER,
      [
        BATCH_ID,
        "Load",
        TEST_DATE,
        1,
        "Thai Tea Less Sugar w/ Lychee 16oz",
        0,
        0,
        4,
        4,
        4,
      ],
    ]);
    const inventorySheet = await seedInventory([
      ["Drink", "Storage"],
      ["Thai Tea Less Sugar w/ Lychee 16oz", 2],
    ]);
    await seedProductionPlan([
      ["Drink Variation", "Amount to 30TH", "Slot (30TH)"],
    ]);

    let nayaxPutBody;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (url, options = {}) => {
        const urlText = String(url);
        const method = options.method || "GET";
        if (
          urlText.startsWith("https://oauth2.googleapis.com/") ||
          urlText.startsWith("https://sheets.googleapis.com/")
        ) {
          return realFetch(url, options);
        }
        if (urlText.includes("machineProducts") && method === "PUT") {
          nayaxPutBody = JSON.parse(options.body);
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlText.includes("machineProducts")) {
          return new Response(
            JSON.stringify([
              {
                MachineProductID: "mp-1",
                NayaxProductID: "np-1",
                MDBCode: 1,
                PAR: 4,
                MissingStockByMDB: 2,
                DEXProductName: "Thai Tea Less Sugar w/ Lychee 16oz",
              },
            ]),
            { headers: { "Content-Type": "application/json" } },
          );
        }
        throw new Error(`Unexpected URL: ${urlText}`);
      },
    );

    const { POST } = await import("../../src/pages/api/restock-submit.js");
    const response = await POST({
      request: jsonRequest({
        key: "integration-secret",
        batchId: BATCH_ID,
        event: "Topoff",
        machine: "30TH",
        date: TEST_DATE,
        duration: "3m 10s",
        slots: [{ slot: 1, waste: 1, new: 2 }],
      }),
    });

    expect(response.status).toBe(200);
    expect(nayaxPutBody).toEqual([
      {
        MachineProductID: "mp-1",
        NayaxProductID: "np-1",
        MachineID: "machine-1",
        MDBCode: 1,
        PAR: 3,
        DEXProductName: "Thai Tea Less Sugar w/ Lychee 16oz",
      },
    ]);

    const logRows = await readSheetValues(
      requireEnv("RESTOCK_LOG_SHEET_ID"),
      "Restock Log",
      "A1:J3",
    );
    expect(logRows.at(-1)).toEqual([
      BATCH_ID,
      "Topoff",
      TEST_DATE,
      "1",
      "Thai Tea Less Sugar w/ Lychee 16oz",
      "2",
      "1",
      "2",
      "3",
      "2",
    ]);

    const inventoryRows = await readSheetValues(
      requireEnv("INVENTORY_SHEET_ID"),
      inventorySheet,
      "A1:B2",
    );
    expect(inventoryRows).toEqual([
      ["Drink", "Storage"],
      ["Thai Tea Less Sugar w/ Lychee 16oz", "0"],
    ]);
  });
});
