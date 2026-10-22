// Live submit test: real Nayax (Towne, the machine named "test") and the
// (Testing) workbooks, nothing mocked. It creates Towne slot 50 with a
// Load and restores Towne from a snapshot even if an assertion fails.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  clearSheetRange,
  readSheetValues,
  seedSheet,
} from "./support/google-sheets-client.js";
import { RESTOCK_LOG_HEADER } from "../../src/lib/restock/config.js";
import { SUBMIT_STATUS } from "../../src/lib/restock/restock-log.js";

const SLOT = 50;
const DATE = "2099-01-01"; // far future: never collides with real batches
const BATCH_ID = `Towne-${DATE}`;
const DRINK = "Taro Tea 22oz Less Sweet w/ Lychee"; // TARO_22_LESS_LYC, already on Towne
const COMPARED_FIELDS = [
  "MachineProductID", "NayaxProductID", "MDBCode", "PAR",
  "MissingStockByMDB", "DEXProductName", "CashPrice", "CreditCardPrice",
];
const NAYAX_SETTLE_MS = 3000;
const NAYAX_RETRIES = 3;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const TOWNE = () => requireEnv("NAYAX_MACHINE_TOWNE_ID");
const LOG_SHEET = () => requireEnv("RESTOCK_LOG_SHEET_ID");

async function nayax(path, options = {}) {
  const response = await fetch(`${requireEnv("NAYAX_BASE_URL")}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${requireEnv("NAYAX_API_TOKEN")}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) throw new Error(`Nayax ${path}: ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

const towneProducts = () => nayax(`/machines/${TOWNE()}/machineProducts`);
const pick = (p) => Object.fromEntries(COMPARED_FIELDS.map((k) => [k, p[k]]));

async function post(body) {
  const { POST } = await import("../../src/pages/api/restock.js");
  const response = await POST({
    request: new Request("https://orble.test/api/restock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: process.env.RESTOCK_SECRET_KEY,
        batchId: BATCH_ID,
        duration: "1m 0s",
        ...body,
      }),
    }),
  });
  return { status: response.status, json: await response.json() };
}

// Nayax can 404 a PUT naming a record it created a moment earlier. The
// restocker presses Complete again and the resume finishes; so does the test.
async function submit(body) {
  let result = await post(body);
  for (let i = 0; i < NAYAX_RETRIES; i++) {
    if (result.json.details?.operation !== "put_machine_products") return result;
    await new Promise((resolve) => setTimeout(resolve, NAYAX_SETTLE_MS));
    result = await post(body);
  }
  return result;
}

async function logRows() {
  const [header, ...rows] = await readSheetValues(LOG_SHEET(), "Restock Log");
  return rows
    .map((row) => Object.fromEntries(header.map((h, i) => [h, row[i] ?? ""])))
    .filter((row) => row["Batch ID"] === BATCH_ID);
}

/** The test slot's entry in a row's Slot Data. */

describe("restock submit, live", () => {
  let snapshot;

  beforeAll(async () => {
    vi.stubEnv("RESTOCK_SLOTS_TOWNE", String(SLOT));
    snapshot = await towneProducts();
    // Refuse to run if slot 50 is in use: the test must own it.
    expect(snapshot.some((p) => p.MDBCode === SLOT)).toBe(false);
    await seedSheet(LOG_SHEET(), "Restock Log", [Object.values(RESTOCK_LOG_HEADER)]);
    await seedSheet(requireEnv("PRODUCTION_PLAN_SHEET_ID"), "Production Plan", [
      ["Drink Variation", "Amount to Towne", "Slot (Towne)"],
      [DRINK, 3, String(SLOT)],
    ]);
  });

  afterAll(async () => {
    // Put Towne back exactly as it was: a full PUT of the snapshot drops
    // slot 50 if a failed run left it behind.
    const now = await towneProducts();
    if (now.some((p) => p.MDBCode === SLOT)) {
      await nayax(`/machines/${TOWNE()}/machineProducts`, {
        method: "PUT",
        body: JSON.stringify(snapshot),
      });
    }
    await clearSheetRange(LOG_SHEET(), "Restock Log");
    await clearSheetRange(requireEnv("PRODUCTION_PLAN_SHEET_ID"), "Production Plan");
    vi.unstubAllEnvs();
  });

  it("Load creates the slot in Nayax, leaves every other Towne slot untouched, and logs a Load row", async () => {
    const { status, json } = await submit({
      event: "Load",
      slots: [
        {
          slot: SLOT,
          drink: { flavor: "Taro Tea", size: "22oz", topping: "Lychee", sweetness: "Less Sweet" },
          previousDrink: null,
          previous: 0,
          waste: 0,
          new: 3,
        },
      ],
    });
    expect(status, JSON.stringify(json)).toBe(200);

    const after = await towneProducts();
    expect(after.filter((p) => p.MDBCode !== SLOT).map(pick)).toEqual(snapshot.map(pick));
    const created = after.find((p) => p.MDBCode === SLOT);
    expect(created).toMatchObject({
      PAR: 3,
      MissingStockByMDB: 0,
      DEXProductName: "TARO_22_LESS_LYC",
    });
    expect(created.CashPrice).toBeGreaterThan(0); // prices copied, not blanked

    // The row reached the real sheet and the submit finished; its shape is unit-tested
    expect((await logRows()).map((row) => row.Status)).toEqual([SUBMIT_STATUS.COMPLETE]);
  });
});
