// Route tests for POST /api/restock-submit: the rejections that must write
// nothing. Nayax and Google Sheets are faked at fetch. Every success and
// failure path through the saga runs end to end in
// tests/e2e/backend/submit-failures.spec.js.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MESSAGES } from "../../../src/lib/restock/errors.js";
import {
  RESTOCK_LOG_HEADER,
  SAGA_STATUS,
  buildRestockLogRows,
} from "../../../src/lib/restock/submit-service.js";

const BATCH_ID = "30th-2026-07-10";
const THAI_PARTS = { flavor: "Thai Tea", size: "16oz", topping: "Lychee", sweetness: "Less Sweet" };
const MATCHA_PARTS = { flavor: "Matcha", size: "16oz", topping: null, sweetness: "Less Sweet" };
const EMPTY_SLOT_2 = { slot: 2, drink: null, previousDrink: null, previous: 0, waste: 0, new: 0 };

const LOAD_SLOTS = [
  { slot: 1, drink: MATCHA_PARTS, previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee", previous: 3, waste: 3, new: 3 },
  EMPTY_SLOT_2,
];
const TOPOFF_SLOTS = [
  { slot: 1, drink: THAI_PARTS, previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee", previous: 3, waste: 0, new: 1 },
  EMPTY_SLOT_2,
];

function body(event, slots, overrides = {}) {
  return {
    key: "secret",
    batchId: BATCH_ID,
    event,
    machine: "30th",
    date: "2026-07-10",
    duration: "5m 32s",
    slots,
    ...overrides,
  };
}

function makeRequest(requestBody) {
  return new Request("https://orble.test/api/restock-submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof requestBody === "string" ? requestBody : JSON.stringify(requestBody),
  });
}

/** A log row in sheet order, for an event whose submit is stored. */
function logRow(event, status, slots = LOAD_SLOTS) {
  const [row] = buildRestockLogRows({
    batchId: BATCH_ID,
    previousBatchId: null,
    visitDate: "2026-07-10",
    duration: "5m 32s",
    event,
    submittedSlots: slots,
    expectedSlots: slots.map((s) => ({ slot: s.slot })),
    status,
  });
  return RESTOCK_LOG_HEADER.map((column) => row[column]);
}

const THAI_30TH = {
  MachineProductID: "mp-1",
  NayaxProductID: 1001,
  MachineID: 1,
  MDBCode: 1,
  PAR: 4,
  MissingStockByMDB: 1, // on hand 3
  DEXProductName: "THAI_16_LESS_LYC",
  CashPrice: 6.5,
  CreditCardPrice: 6.5,
};

/** Fake Nayax + Sheets reads. Every call is recorded; writes must not happen. */
function installFakes({ logRows = [] } = {}) {
  const calls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init = {}) => {
    const url = decodeURIComponent(String(input));
    const method = (init.method || "GET").toUpperCase();
    calls.push({ method, url });
    const ok = (data) => new Response(JSON.stringify(data));
    if (method !== "GET") return ok({});
    if (url.includes("/machines/machine-1/machineProducts")) return ok([THAI_30TH]);
    if (url.includes("/machines/machine-2/machineProducts")) return ok([]);
    if (url.includes("/values/") && url.includes("Restock Log"))
      return ok({ values: [RESTOCK_LOG_HEADER, ...logRows] });
    if (url.includes("/values/") && url.includes("Production Plan"))
      return ok({
        values: [
          ["Drink Variation", "Amount to 30th", "Slot (30th)"],
          ["Matcha 16oz Less Sweet", 3, "1"],
        ],
      });
    if (url.includes("inventory-sheet")) {
      if (url.includes("/values/"))
        return ok({ values: [["Drink", "To 30th"], ["Thai Tea 16oz Less Sweet w/ Lychee", 1]] });
      return ok({ sheets: [{ properties: { title: "2026-07-10" } }] });
    }
    throw new Error(`Unexpected ${method} ${url}`);
  });
  return calls;
}

const writes = (calls) => calls.filter((c) => c.method !== "GET");

describe("POST /api/restock-submit rejections", () => {
  let POST;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-10T15:00:00Z"));
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "sheets-token");
    vi.stubEnv("NAYAX_API_TOKEN", "nayax-token");
    vi.stubEnv("NAYAX_MACHINE_30TH_ID", "machine-1");
    vi.stubEnv("NAYAX_MACHINE_TOWNE_ID", "machine-2");
    vi.stubEnv("PRODUCTION_PLAN_SHEET_ID", "plan-sheet");
    vi.stubEnv("INVENTORY_SHEET_ID", "inventory-sheet");
    vi.stubEnv("RESTOCK_LOG_SHEET_ID", "log-sheet");
    vi.stubEnv("RESTOCK_SLOTS_30TH", "1,2"); // keep the payloads small
    ({ POST } = await import("../../../src/pages/api/restock-submit.js"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  // Checks that need only the request: rejected before any read
  const requestOnly = [
    { name: "malformed JSON", request: "{not json", status: 400, error: "Invalid JSON body" },
    { name: "an invalid secret key", request: body("Load", LOAD_SLOTS, { key: "bad" }), status: 403, error: "Invalid RESTOCK_SECRET_KEY" },
    { name: "missing fields", request: body("Load", undefined), status: 400, error: "Missing required fields" },
    {
      name: "a batchId that does not match the machine and date",
      request: body("Load", LOAD_SLOTS, { batchId: "30th-2026-07-03" }),
      status: 400,
      error: "batchId does not match the machine and date",
    },
    {
      name: "a slot with no drink that still holds drinks",
      request: body("Topoff", [{ ...TOPOFF_SLOTS[0], drink: null, new: 0 }, EMPTY_SLOT_2]),
      status: 400,
      error: expect.stringMatching(/slot 1: a slot with no drink must end at 0, not 3/),
    },
  ];
  for (const c of requestOnly) {
    it(`rejects ${c.name} before reading anything`, async () => {
      const calls = installFakes();
      const response = await POST({ request: makeRequest(c.request) });
      expect(response.status).toBe(c.status);
      expect(await response.json()).toEqual({ error: c.error });
      expect(calls).toEqual([]);
    });
  }

  // decideSaga covers each log rejection, this checks the route writes nothing
  it("rejects a batch that was already cleared out without writing", async () => {
    const calls = installFakes({
      logRows: [logRow("Load", SAGA_STATUS.complete), logRow("Clearout", SAGA_STATUS.complete)],
    });
    const response = await POST({ request: makeRequest(body("Topoff", TOPOFF_SLOTS)) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: MESSAGES.batchClearedOut });
    expect(writes(calls)).toEqual([]);
  });

  it("answers a resend of a Complete submit with 200 and writes nothing", async () => {
    const calls = installFakes({ logRows: [logRow("Load", SAGA_STATUS.complete)] });
    const response = await POST({ request: makeRequest(body("Load", LOAD_SLOTS)) });
    expect(response.status).toBe(200);
    expect(writes(calls)).toEqual([]);
  });
});
