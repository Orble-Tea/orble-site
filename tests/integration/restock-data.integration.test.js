// Live GET /api/restock-data against the 30th machine and the (Testing)
// workbooks. The test owns 30th slots 50-52, which have no physical coils:
// it sets them to a known state, limits the app to them, and puts them back
// from a snapshot afterwards.
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MESSAGES } from "../../src/lib/restock/errors.js";
import { RESTOCK_LOG_HEADER } from "../../src/lib/restock/submit-service.js";

import {
  clearSheetRange,
  clearLatestSheet,
  seedLatestSheet,
  seedSheet,
} from "./support/google-sheets-client.js";

const TEST_DATE = "2026-08-31";
const BATCH_ID = `30th-${TEST_DATE}`;
const OWNED_SLOTS = [50, 51, 52];
// Slot 50 holds THAI with 1 on hand; 51 and 52 hold MATCHA with 0 on hand
const THAI = "Thai Tea 16oz Less Sweet w/ Lychee"; // 4 per slot
const MATCHA = "Matcha 16oz Less Sweet";
const PAR = 4;
const THAI_PARTS = {
  flavor: "Thai Tea",
  size: "16oz",
  topping: "Lychee",
  sweetness: "Less Sweet",
};

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const thirtieth = () => requireEnv("NAYAX_MACHINE_30TH_ID");
const nayax = () => import("../../src/lib/restock/nayax.js");

/** A Load (and optionally more events) already logged for the batch. */
const logRows = (...events) => [
  RESTOCK_LOG_HEADER,
  ...events.map((event) => [
    BATCH_ID,
    event,
    TEST_DATE,
    "1m 0s",
    "[]",
    "Complete",
  ]),
];

async function seedRestockLog(rows) {
  await seedSheet(requireEnv("RESTOCK_LOG_SHEET_ID"), "Restock Log", rows);
}

async function seedProductionPlan(rows) {
  await seedSheet(
    requireEnv("PRODUCTION_PLAN_SHEET_ID"),
    "Production Plan",
    rows,
  );
}

async function seedInventory(toThirtieth) {
  await seedLatestSheet(requireEnv("INVENTORY_SHEET_ID"), [
    ["Drink", "Storage", "To 30TH"],
    [THAI, 2, toThirtieth],
  ]);
}

async function getRestockData(query = "") {
  const { GET } = await import("../../src/pages/api/restock-data.js");
  return GET({
    url: new URL(
      `https://orble.test/api/restock-data?key=integration-secret&machine=30th&date=${TEST_DATE}${query}`,
    ),
  });
}

const slotOf = (body, slot) => body.slots.find((s) => s.slot === slot);

function expectRestockDataSlotContract(slot) {
  expect(slot).toHaveProperty("previousDrink");
  expect(slot).toHaveProperty("expectedNew");
  expect(slot).not.toHaveProperty("unassigned");
  expect(slot).not.toHaveProperty("drink");
  expect(slot).not.toHaveProperty("empty");
  expect(slot).not.toHaveProperty("new");
}

describe("restock data integration", () => {
  let snapshot;

  beforeAll(async () => {
    const {
      getMachineProducts,
      getProductName,
      getProductSlot,
      putMachineProducts,
    } = await nayax();
    const { normalizeDrinkName } =
      await import("../../src/lib/restock/drinks.js");
    const products = await getMachineProducts(thirtieth());
    snapshot = products.filter((p) => OWNED_SLOTS.includes(getProductSlot(p)));
    // Updated in place, never created or removed, so the restore is exact
    expect(snapshot.map(getProductSlot).sort()).toEqual(OWNED_SLOTS);

    const source = (drink) => {
      const found = products.find(
        (p) =>
          !OWNED_SLOTS.includes(getProductSlot(p)) &&
          normalizeDrinkName(getProductName(p)) === drink,
      );
      if (!found) throw new Error(`30th has no slot holding ${drink} to copy`);
      const { NayaxProductID, DEXProductName, CashPrice, CreditCardPrice } =
        found;
      return { NayaxProductID, DEXProductName, CashPrice, CreditCardPrice };
    };
    const onHand = { 50: 1, 51: 0, 52: 0 };
    await putMachineProducts(
      thirtieth(),
      snapshot.map((p) => {
        const slot = getProductSlot(p);
        return {
          ...p,
          ...source(slot === 50 ? THAI : MATCHA),
          PAR,
          MissingStockByMDB: PAR - onHand[slot],
        };
      }),
      { avoidDelete: true },
    );
  });

  afterAll(async () => {
    if (!snapshot) return;
    const { putMachineProducts } = await nayax();
    await putMachineProducts(thirtieth(), snapshot, { avoidDelete: true });
  });

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("RESTOCK_SECRET_KEY", "integration-secret");
    vi.stubEnv("RESTOCK_SLOTS_30TH", OWNED_SLOTS.join(","));
    vi.stubEnv(
      "NAYAX_BASE_URL",
      process.env.NAYAX_BASE_URL || "https://lynx.nayax.com/operational/v1",
    );
    vi.stubEnv("NAYAX_MACHINE_30TH_ID", thirtieth());
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
    vi.stubEnv("NAYAX_API_TOKEN", requireEnv("NAYAX_API_TOKEN"));
    await seedRestockLog([RESTOCK_LOG_HEADER]);
  });

  afterEach(async () => {
    await clearSheetRange(
      requireEnv("PRODUCTION_PLAN_SHEET_ID"),
      "Production Plan",
    );
    await clearSheetRange(requireEnv("RESTOCK_LOG_SHEET_ID"), "Restock Log");
    await clearLatestSheet(requireEnv("INVENTORY_SHEET_ID"));
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("builds a Load from the Production Plan's slots, not the drinks Nayax has now", async () => {
    await seedProductionPlan([
      ["Drink Variation", "Amount to 30TH", "Slot (30TH)"],
      [THAI, 4, "51, 52"],
    ]);

    const response = await getRestockData();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      batchId: BATCH_ID,
      event: "Load",
      machine: "30th",
    });
    for (const slot of [51, 52]) {
      expect(slotOf(body, slot)).toMatchObject({
        ...THAI_PARTS,
        previousDrink: MATCHA,
        previous: 0,
        expectedNew: 2,
      });
    }
    // THAI is in slot 50 now, but the plan does not put it there
    expect(slotOf(body, 50)).toMatchObject({
      previousDrink: THAI,
      flavor: null,
      previous: 1,
      waste: 1,
      expectedNew: 0,
      total: 0,
    });
    body.slots.forEach(expectRestockDataSlotContract);
  });

  const topoffs = [
    { name: "sends what storage allocated", toThirtieth: 2, expectedNew: 2 },
    {
      name: "uses a manually reduced allocation after a spill",
      toThirtieth: 1,
      expectedNew: 1,
    },
    {
      name: "adds nothing when nothing was allocated",
      toThirtieth: 0,
      expectedNew: 0,
    },
  ];
  for (const c of topoffs) {
    it(`builds a Topoff from the latest inventory sheet: ${c.name}`, async () => {
      await seedInventory(c.toThirtieth);
      await seedRestockLog(logRows("Load"));

      const response = await getRestockData();

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        batchId: BATCH_ID,
        event: "Topoff",
        machine: "30th",
      });
      expect(slotOf(body, 50)).toMatchObject({
        previousDrink: THAI,
        previous: 1,
        waste: 0,
        expectedNew: c.expectedNew,
        total: 1 + c.expectedNew,
      });
      // No MATCHA in storage
      expect(slotOf(body, 51)).toMatchObject({
        previousDrink: MATCHA,
        expectedNew: 0,
      });
      body.slots.forEach(expectRestockDataSlotContract);
    });
  }

  it("builds a Clearout for the batch after its Load", async () => {
    await seedRestockLog(logRows("Load"));

    const response = await getRestockData("&mode=clearout");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ batchId: BATCH_ID, event: "Clearout" });
    expect(slotOf(body, 50)).toMatchObject({
      previous: 1,
      waste: 1,
      expectedNew: 0,
      total: 0,
    });
  });

  it("returns a conflict once Load and Topoff already exist for the batch", async () => {
    await seedRestockLog(logRows("Load", "Topoff"));

    const response = await getRestockData();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: MESSAGES.alreadySubmitted,
      existingEntryRow: 2,
    });
  });
});
