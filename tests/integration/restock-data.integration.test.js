import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSheetRange,
  clearLatestSheet,
  seedLatestSheet,
  seedSheet,
} from "./support/google-sheets-client.js";
import {
  normalizeDrinkName,
  parseDrinkName,
  slotCapacityForDrink,
} from "../../src/lib/restock/drinks.js";

const TEST_DATE = "2026-08-31";
const BATCH_ID = `30TH-${TEST_DATE}`;
const PRODUCTION_PLAN_ROWS = [
  ["Drink Variation", "Amount to 30TH", "Slot (30TH)"],
  ["Thai Tea Less Sweet w/ Lychee 16oz", 4, "1, 2"],
];
const RESTOCK_LOG_HEADER = [["Batch ID", "Event", "Date", "Slot", "Drink", "Previous", "Waste", "New", "Total", "Expected"]];
const INVENTORY_ROWS = [
  ["Drink", "Storage", "To 30TH"],
  ["Thai Tea 16oz Less Sugar w/ Lychee", 2, 2],
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function seedRestockLog(rows) {
  await seedSheet(requireEnv("RESTOCK_LOG_SHEET_ID"), "Restock Log", rows);
}

async function seedProductionPlan(rows) {
  await seedSheet(requireEnv("PRODUCTION_PLAN_SHEET_ID"), "Production Plan", rows);
}

async function seedInventory(rows) {
  await seedLatestSheet(requireEnv("INVENTORY_SHEET_ID"), rows);
}

async function getLiveTopoffFixture(storage) {
  const {
    getMachineProducts,
    getProductName,
    getProductOnHand,
    getProductSlot,
    hasProductOnHand,
  } = await import("../../src/lib/restock/nayax.js");
  const products = await getMachineProducts(requireEnv("NAYAX_MACHINE_30TH_ID"));
  const product = products.find((candidate) => {
    const slot = getProductSlot(candidate);
    const drink = normalizeDrinkName(getProductName(candidate));
    return (
      Number.isInteger(slot) &&
      slot >= 1 &&
      slot <= 35 &&
      drink &&
      hasProductOnHand(candidate)
    );
  });

  if (!product) {
    throw new Error(
      "Nayax machine has no readable products in slots 1-35 for Topoff integration testing",
    );
  }

  const slot = getProductSlot(product);
  const drink = normalizeDrinkName(getProductName(product));
  const previous = getProductOnHand(product);
  const expectedNew = Math.min(
    storage,
    Math.max(slotCapacityForDrink(drink) - previous, 0),
  );

  return {
    slot,
    drink,
    previous,
    expectedNew,
    total: previous + expectedNew,
  };
}

function chooseDifferentSlots(currentSlot) {
  return [1, 2, 3, 4, 5].filter((slot) => slot !== currentSlot).slice(0, 2);
}

function expectRestockDataSlotContract(slot) {
  expect(slot).toHaveProperty("previousDrink");
  expect(slot).toHaveProperty("expectedNew");
  expect(slot).not.toHaveProperty("drink");
  expect(slot).not.toHaveProperty("new");
}

describe("restock data integration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("RESTOCK_SECRET_KEY", "integration-secret");
    vi.stubEnv(
      "NAYAX_BASE_URL",
      process.env.NAYAX_BASE_URL ||
        "https://lynx.nayax.com/operational/v1",
    );
    vi.stubEnv("NAYAX_MACHINE_30TH_ID", requireEnv("NAYAX_MACHINE_30TH_ID"));
    vi.stubEnv("PRODUCTION_PLAN_SHEET_ID", requireEnv("PRODUCTION_PLAN_SHEET_ID"));
    vi.stubEnv("INVENTORY_SHEET_ID", requireEnv("INVENTORY_SHEET_ID"));
    vi.stubEnv("RESTOCK_LOG_SHEET_ID", requireEnv("RESTOCK_LOG_SHEET_ID"));
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"));
    vi.stubEnv("GOOGLE_PRIVATE_KEY", requireEnv("GOOGLE_PRIVATE_KEY"));
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "");
    vi.stubEnv("NAYAX_API_TOKEN", requireEnv("NAYAX_API_TOKEN"));
  });

  afterEach(async () => {
    await clearSheetRange(requireEnv("PRODUCTION_PLAN_SHEET_ID"), "Production Plan");
    await clearSheetRange(requireEnv("RESTOCK_LOG_SHEET_ID"), "Restock Log");
    await clearLatestSheet(requireEnv("INVENTORY_SHEET_ID"));
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    await seedRestockLog(RESTOCK_LOG_HEADER);
  });

  it("builds Load payloads from the Production Plan workbook", async () => {
    await seedProductionPlan(PRODUCTION_PLAN_ROWS);
    await clearLatestSheet(requireEnv("INVENTORY_SHEET_ID"));

    const { GET } = await import("../../src/pages/api/restock-data.js");
    const response = await GET({
      url: new URL(
        `https://orble.test/api/restock-data?key=integration-secret&machine=30th&date=${TEST_DATE}`,
      ),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      batchId: BATCH_ID,
      event: "Load",
      machine: "30TH",
      slots: expect.arrayContaining([
        expect.objectContaining({
          slot: 1,
          expectedNew: 2,
          empty: false,
        }),
        expect.objectContaining({
          slot: 2,
          expectedNew: 2,
          empty: false,
        }),
      ]),
    });
    expectRestockDataSlotContract(body.slots[0]);
    expectRestockDataSlotContract(body.slots[1]);
  });

  it("uses Production Plan slot assignments for Load when current Nayax slots differ", async () => {
    const liveProduct = await getLiveTopoffFixture(0);
    const targetSlots = chooseDifferentSlots(liveProduct.slot);
    const parsed = parseDrinkName(liveProduct.drink);

    await seedProductionPlan([
      ["Drink Variation", "Amount to 30TH", "Slot (30TH)"],
      [liveProduct.drink, 4, targetSlots.join(", ")],
    ]);
    await clearLatestSheet(requireEnv("INVENTORY_SHEET_ID"));

    const { GET } = await import("../../src/pages/api/restock-data.js");
    const response = await GET({
      url: new URL(
        `https://orble.test/api/restock-data?key=integration-secret&machine=30th&date=${TEST_DATE}`,
      ),
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toMatchObject({
      batchId: BATCH_ID,
      event: "Load",
      machine: "30TH",
    });
    expect(targetSlots).not.toContain(liveProduct.slot);
    for (const slotNumber of targetSlots) {
      const slot = body.slots[slotNumber - 1];
      expectRestockDataSlotContract(slot);
      expect(slot).toMatchObject({
        slot: slotNumber,
        flavor: parsed.flavor,
        size: parsed.size,
        topping: parsed.topping,
        sweetnessLevel: parsed.sweetness,
        expectedNew: 2,
        empty: false,
      });
    }
    expectRestockDataSlotContract(body.slots[liveProduct.slot - 1]);
    expect(body.slots[liveProduct.slot - 1].previousDrink).toBe(
      liveProduct.drink,
    );
    expect(body.slots[liveProduct.slot - 1]).toMatchObject({
      flavor: null,
      size: null,
      topping: null,
      sweetnessLevel: null,
      expectedNew: 0,
      empty: true,
    });
  });

  it("builds Topoff payloads from the latest inventory sheet and reflects manual stock reductions", async () => {
    const topoff = await getLiveTopoffFixture(2);
    await seedInventory([
      ["Drink", "Storage", "To 30TH"],
      [topoff.drink, 2, 2],
    ]);
    await seedSheet(
      requireEnv("RESTOCK_LOG_SHEET_ID"),
      "Restock Log",
      [
        ...RESTOCK_LOG_HEADER,
        [BATCH_ID, "Load", TEST_DATE, topoff.slot, topoff.drink, topoff.previous, 0, 4, 4, 4],
      ],
    );

    const { GET } = await import("../../src/pages/api/restock-data.js");
    const response = await GET({
      url: new URL(
        `https://orble.test/api/restock-data?key=integration-secret&machine=30th&date=${TEST_DATE}`,
      ),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      batchId: BATCH_ID,
      event: "Topoff",
      machine: "30TH",
      slots: expect.arrayContaining([
        expect.objectContaining({
          slot: topoff.slot,
          previous: topoff.previous,
          waste: 0,
          expectedNew: topoff.expectedNew,
          total: topoff.total,
          empty: false,
        }),
      ]),
    });
    const slot = body.slots[topoff.slot - 1];
    expectRestockDataSlotContract(slot);
    expect(slot.previousDrink).toBe(topoff.drink);
  });

  it("uses manually reduced inventory when drinks spill before topoff", async () => {
    const topoff = await getLiveTopoffFixture(1);
    await seedInventory([
      ["Drink", "Storage", "To 30TH"],
      [topoff.drink, 2, 1],
    ]);
    await seedSheet(
      requireEnv("RESTOCK_LOG_SHEET_ID"),
      "Restock Log",
      [
        ...RESTOCK_LOG_HEADER,
        [BATCH_ID, "Load", TEST_DATE, topoff.slot, topoff.drink, topoff.previous, 0, 4, 4, 4],
      ],
    );

    const { GET } = await import("../../src/pages/api/restock-data.js");
    const response = await GET({
      url: new URL(
        `https://orble.test/api/restock-data?key=integration-secret&machine=30th&date=${TEST_DATE}`,
      ),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      batchId: BATCH_ID,
      event: "Topoff",
      slots: expect.arrayContaining([
        expect.objectContaining({
          slot: topoff.slot,
          previous: topoff.previous,
          expectedNew: topoff.expectedNew,
          total: topoff.total,
        }),
      ]),
    });
    expectRestockDataSlotContract(body.slots[topoff.slot - 1]);
  });

  it("returns a conflict once Load and Topoff already exist for the batch", async () => {
    await seedProductionPlan(PRODUCTION_PLAN_ROWS);
    await seedInventory(INVENTORY_ROWS);
    await seedSheet(
      requireEnv("RESTOCK_LOG_SHEET_ID"),
      "Restock Log",
      [
        ...RESTOCK_LOG_HEADER,
        [BATCH_ID, "Load", TEST_DATE, 1, "Thai Tea Less Sweet w/ Lychee 16oz", 1, 0, 4, 4, 4],
        [BATCH_ID, "Topoff", TEST_DATE, 1, "Thai Tea Less Sweet w/ Lychee 16oz", 1, 0, 2, 3, 2],
      ],
    );

    const { GET } = await import("../../src/pages/api/restock-data.js");
    const response = await GET({
      url: new URL(
        `https://orble.test/api/restock-data?key=integration-secret&machine=30th&date=${TEST_DATE}`,
      ),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "This event has already been submitted for this batch.",
      existingEntryRow: 2,
    });
  });
});
