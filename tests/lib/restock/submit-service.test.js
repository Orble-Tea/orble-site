// Unit tests for the pure submit builders: validation, Restock Log rows, the
// saga decision, and the Nayax write plan. Failures at each step are covered
// end to end in tests/e2e/backend/submit-failures.spec.js.
import { describe, expect, it } from "vitest";
import {
  MESSAGES,
  needsEventFirst,
} from "../../../src/lib/restock/errors.js";
import {
  RESTOCK_LOG_HEADER,
  SAGA_STATUS,
  buildNayaxCatalog,
  buildNayaxUpdate,
  buildRestockLogRows,
  decideSaga,
  formatDrinkName,
  parseSlotData,
  sameSlots,
  validateSubmission,
} from "../../../src/lib/restock/submit-service.js";

/**
 * A submitted slot in the POST shape: the full state the restocker
 * confirmed. `drink` is the parts going in (null = Empty); `previousDrink`
 * is what was physically in the slot (null = was empty).
 */
function submitted(overrides) {
  return {
    slot: 1,
    drink: null,
    previousDrink: null,
    previous: 0,
    waste: 0,
    new: 0,
    ...overrides,
  };
}

/** An expected slot in the GET shape (what the form was prefilled with). */
function expected(overrides) {
  return {
    slot: 1,
    previousDrink: null,
    flavor: null,
    size: null,
    topping: null,
    sweetness: null,
    previous: 0,
    waste: 0,
    expectedNew: 0,
    total: 0,
    ...overrides,
  };
}

/** A Nayax machine product as GET /machineProducts returns it. */
function product(overrides) {
  return {
    MachineProductID: "mp-1",
    NayaxProductID: 1001,
    MachineID: 9999,
    MDBCode: 1,
    PAR: 4,
    MissingStockByMDB: 1,
    DEXProductName: "THAI_16_LESS_LYC",
    CashPrice: 6.5,
    CreditCardPrice: 6.5,
    RetailPrice: 6.5,
    ...overrides,
  };
}

const THAI = {
  flavor: "Thai Tea",
  size: "16oz",
  sweetness: "Less Sweet",
  topping: "Lychee",
};
const MATCHA = { flavor: "Matcha", size: "16oz", sweetness: "Less Sweet" };

describe("formatDrinkName", () => {
  it("formats drink parts the way Nayax codes expand", () => {
    expect(formatDrinkName(THAI)).toBe("Thai Tea 16oz Less Sweet w/ Lychee");
    expect(formatDrinkName(MATCHA)).toBe("Matcha 16oz Less Sweet");
    expect(formatDrinkName({ flavor: null })).toBe("");
  });
});

describe("validateSubmission", () => {
  const machineSlots = [1, 2];
  const loadExpected = [
    expected({ slot: 1, previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee", previous: 2, waste: 2 }),
    expected({ slot: 2 }),
  ];
  const topoffExpected = [
    expected({ slot: 1, ...THAI, previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee", previous: 3 }),
    expected({ slot: 2 }),
  ];
  const ok = (event, slots) => ({ event, slots, machineSlots });

  const cases = [
    {
      name: "a valid Load",
      input: ok("Load", [
        submitted({ slot: 1, drink: MATCHA, previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee", previous: 2, waste: 2, new: 4 }),
        submitted({ slot: 2 }),
      ]),
      expectedSlots: loadExpected,
      error: null,
    },
    {
      name: "a Load that leaves old drinks in the slot",
      input: ok("Load", [
        submitted({ slot: 1, drink: MATCHA, previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee", previous: 3, waste: 2, new: 1 }),
        submitted({ slot: 2 }),
      ]),
      expectedSlots: loadExpected,
      error: /slot 1: a Load must take out all 3 previous/i,
    },
    {
      name: "a missing slot",
      input: ok("Load", [submitted({ slot: 1, previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee", previous: 2, waste: 2 })]),
      expectedSlots: loadExpected,
      error: /slot 2 is missing/i,
    },
    {
      name: "a duplicated slot",
      input: ok("Load", [submitted({ slot: 1, previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee", previous: 2, waste: 2 }), submitted({ slot: 1, previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee", previous: 2, waste: 2 })]),
      expectedSlots: loadExpected,
      error: /slot 1 appears more than once/i,
    },
    {
      name: "a slot the machine does not have",
      input: ok("Load", [submitted({ slot: 1, previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee", previous: 2, waste: 2 }), submitted({ slot: 2 }), submitted({ slot: 36 })]),
      expectedSlots: loadExpected,
      error: /slot 36 is not configured/i,
    },
    {
      name: "a negative count",
      input: ok("Load", [submitted({ slot: 1, previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee", previous: 2, waste: 2, new: -1 }), submitted({ slot: 2 })]),
      expectedSlots: loadExpected,
      error: /slot 1: new must be a non-negative integer/i,
    },
    {
      name: "new over the slot's headroom",
      input: ok("Topoff", [
        submitted({ slot: 1, drink: THAI, previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee", previous: 3, waste: 0, new: 2 }),
        submitted({ slot: 2 }),
      ]),
      expectedSlots: topoffExpected,
      error: /slot 1: new 2 exceeds the 1 free/i,
    },
    {
      name: "Topoff waste above the Nayax count",
      input: ok("Topoff", [
        submitted({ slot: 1, drink: THAI, previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee", previous: 3, waste: 4, new: 0 }),
        submitted({ slot: 2 }),
      ]),
      expectedSlots: topoffExpected,
      error: /slot 1: waste 4 exceeds previous 3/i,
    },
    {
      name: "Topoff waste above a corrected previous count",
      input: ok("Topoff", [
        submitted({ slot: 1, drink: THAI, previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee", previous: 2, waste: 3, new: 0 }),
        submitted({ slot: 2 }),
      ]),
      expectedSlots: topoffExpected,
      error: /slot 1: waste 3 exceeds previous 2/i,
    },
    {
      name: "a Topoff whose corrected previous count frees more space",
      // Nayax says 3 (1 free); really 2, so 2 new fit.
      input: ok("Topoff", [
        submitted({ slot: 1, drink: THAI, previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee", previous: 2, waste: 0, new: 2 }),
        submitted({ slot: 2 }),
      ]),
      expectedSlots: topoffExpected,
      error: null,
    },
    {
      name: "a Topoff that swaps the drink",
      input: ok("Topoff", [
        submitted({ slot: 1, drink: MATCHA, previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee", previous: 3, waste: 0, new: 1 }),
        submitted({ slot: 2 }),
      ]),
      expectedSlots: topoffExpected,
      error: /slot 1: a Topoff cannot change the drink/i,
    },
    {
      name: "a Topoff that corrects the previous drink and keeps it",
      input: ok("Topoff", [
        submitted({ slot: 1, drink: MATCHA, previousDrink: "Matcha 16oz Less Sweet", previous: 3, waste: 0, new: 1 }),
        submitted({ slot: 2 }),
      ]),
      expectedSlots: topoffExpected,
      error: null,
    },
    {
      name: "a slot with no drink that still holds drinks",
      // Would delete the Nayax product while logging Total 3
      input: ok("Topoff", [
        submitted({ slot: 1, previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee", previous: 3, waste: 0, new: 0 }),
        submitted({ slot: 2 }),
      ]),
      expectedSlots: topoffExpected,
      error: /slot 1: a slot with no drink must end at 0, not 3/i,
    },
  ];

  for (const c of cases) {
    it(`${c.error ? "rejects" : "accepts"} ${c.name}`, () => {
      const result = validateSubmission({ ...c.input, expectedSlots: c.expectedSlots });
      if (c.error) expect(result).toMatch(c.error);
      else expect(result).toBeNull();
    });
  }
});


/** One Slot Data entry: every field, defaults for an empty slot. */
function entry(fields) {
  return {
    Slot: 1,
    Drink: null,
    "Expected Drink": null,
    "Previous Drink": null,
    "Expected Previous Drink": null,
    Previous: 0,
    "Expected Previous": 0,
    Waste: 0,
    "Expected Waste": 0,
    New: 0,
    "Expected New": 0,
    Total: 0,
    ...fields,
  };
}

describe("buildRestockLogRows", () => {
  const base = {
    batchId: "Towne-2026-07-10",
    previousBatchId: "Towne-2026-07-03",
    visitDate: "2026-07-10",
    duration: "5m 32s",
  };
  const slotData = (row) => parseSlotData(row["Slot Data"]);

  it("writes a Load as a Clearout row closing the old batch and a Load row, sharing every slot", () => {
    const rows = buildRestockLogRows({
      ...base,
      event: "Load",
      submittedSlots: [
        submitted({ slot: 1, drink: THAI, previousDrink: "Mango Passion Fruit Tea 16oz", previous: 3, waste: 3, new: 3 }),
        submitted({ slot: 2 }),
      ],
      expectedSlots: [
        expected({ slot: 1, ...THAI, previousDrink: "Taro Tea 16oz", previous: 2, waste: 2, expectedNew: 4 }),
        expected({ slot: 2 }),
      ],
    });

    const slots = [
      entry({
        Slot: 1,
        Drink: "Thai Tea 16oz Less Sweet w/ Lychee",
        "Expected Drink": "Thai Tea 16oz Less Sweet w/ Lychee",
        "Previous Drink": "Mango Passion Fruit Tea 16oz", // corrected by the restocker
        "Expected Previous Drink": "Taro Tea 16oz", // what Nayax said
        Previous: 3,
        "Expected Previous": 2,
        Waste: 3,
        "Expected Waste": 2,
        New: 3,
        "Expected New": 4,
        Total: 3,
      }),
      entry({ Slot: 2 }), // empty slots are stored too
    ];
    expect(rows.map((row) => Object.keys(row))).toEqual([RESTOCK_LOG_HEADER, RESTOCK_LOG_HEADER]);
    expect(rows.map(({ "Slot Data": _slotData, ...rest }) => rest)).toEqual([
      { "Batch ID": "Towne-2026-07-03", Event: "Clearout", Date: "2026-07-10", Duration: "5m 32s", Status: SAGA_STATUS.pending },
      { "Batch ID": "Towne-2026-07-10", Event: "Load", Date: "2026-07-10", Duration: "5m 32s", Status: SAGA_STATUS.pending },
    ]);
    expect(slotData(rows[0])).toEqual(slots);
    expect(slotData(rows[1])).toEqual(slots);
  });

  it("writes only the Load row when the machine has no earlier batch", () => {
    const rows = buildRestockLogRows({
      ...base,
      previousBatchId: null,
      event: "Load",
      submittedSlots: [submitted({ slot: 1, drink: MATCHA, new: 4 })],
      expectedSlots: [expected({ slot: 1, ...MATCHA, expectedNew: 4 })],
    });
    expect(rows.map((row) => row.Event)).toEqual(["Load"]);
  });

  it("writes one Topoff row with the corrected previous count next to the Nayax count", () => {
    const rows = buildRestockLogRows({
      ...base,
      event: "Topoff",
      visitDate: "2026-07-13",
      submittedSlots: [
        submitted({ slot: 1, drink: THAI, previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee", previous: 1, waste: 0, new: 3 }),
      ],
      expectedSlots: [
        expected({ slot: 1, ...THAI, previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee", previous: 2, expectedNew: 2 }),
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ "Batch ID": "Towne-2026-07-10", Event: "Topoff", Date: "2026-07-13" });
    expect(slotData(rows[0])).toEqual([
      entry({
        Slot: 1,
        Drink: "Thai Tea 16oz Less Sweet w/ Lychee",
        "Expected Drink": "Thai Tea 16oz Less Sweet w/ Lychee",
        "Previous Drink": "Thai Tea 16oz Less Sweet w/ Lychee",
        "Expected Previous Drink": "Thai Tea 16oz Less Sweet w/ Lychee",
        Previous: 1,
        "Expected Previous": 2,
        New: 3,
        "Expected New": 2,
        Total: 4,
      }),
    ]);
  });

  it("writes the old batch's Clearout row even when the machine sold out", () => {
    // Otherwise the old batch looks open and a resend finds no row
    const rows = buildRestockLogRows({
      ...base,
      event: "Load",
      submittedSlots: [
        submitted({ slot: 1, drink: MATCHA, previousDrink: "Taro Tea 16oz", new: 4 }),
        submitted({ slot: 2 }),
      ],
      expectedSlots: [
        expected({ slot: 1, ...MATCHA, previousDrink: "Taro Tea 16oz", expectedNew: 4 }),
        expected({ slot: 2 }),
      ],
    });
    const slots = [
      entry({
        Slot: 1,
        Drink: "Matcha 16oz Less Sweet",
        "Expected Drink": "Matcha 16oz Less Sweet",
        "Previous Drink": "Taro Tea 16oz",
        "Expected Previous Drink": "Taro Tea 16oz",
        New: 4,
        "Expected New": 4,
        Total: 4,
      }),
      entry({ Slot: 2 }),
    ];
    expect(rows.map((row) => [row["Batch ID"], row.Event])).toEqual([
      ["Towne-2026-07-03", "Clearout"],
      ["Towne-2026-07-10", "Load"],
    ]);
    expect(slotData(rows[0])).toEqual(slots);
    expect(slotData(rows[1])).toEqual(slots);
  });
});

describe("sameSlots", () => {
  const stored = buildRestockLogRows({
    batchId: "Towne-2026-07-10",
    previousBatchId: null,
    visitDate: "2026-07-13",
    duration: "5m 32s",
    event: "Topoff",
    submittedSlots: [
      submitted({ slot: 1, drink: THAI, previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee", previous: 2, waste: 1, new: 2 }),
      submitted({ slot: 2 }),
    ],
    expectedSlots: [expected({ slot: 1 }), expected({ slot: 2 })],
  })[0];
  const entries = parseSlotData(stored["Slot Data"]);
  const resubmit = (slot1) => [
    submitted({ slot: 1, drink: THAI, previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee", previous: 2, waste: 1, new: 2, ...slot1 }),
    submitted({ slot: 2 }),
  ];

  it("matches a resend of the stored submit, in any slot order", () => {
    expect(sameSlots(resubmit({}), entries)).toBe(true);
    expect(sameSlots(resubmit({}).reverse(), entries)).toBe(true);
  });

  it("does not match when a count, the drink, or the previous drink changed", () => {
    expect(sameSlots(resubmit({ new: 1 }), entries)).toBe(false);
    expect(sameSlots(resubmit({ waste: 0 }), entries)).toBe(false);
    expect(sameSlots(resubmit({ previous: 3 }), entries)).toBe(false);
    expect(sameSlots(resubmit({ drink: MATCHA }), entries)).toBe(false);
    expect(sameSlots(resubmit({ previousDrink: "Matcha 16oz Less Sweet" }), entries)).toBe(false);
  });
});

describe("decideSaga", () => {
  const BATCH = "30th-2026-07-10";
  const slots = [submitted({ slot: 1, drink: MATCHA, new: 3 })];
  const storedSlotData = buildRestockLogRows({
    batchId: BATCH,
    previousBatchId: null,
    visitDate: "2026-07-10",
    duration: "1m 0s",
    event: "Load",
    submittedSlots: slots,
    expectedSlots: [expected({ slot: 1, ...MATCHA, expectedNew: 3 })],
  })[0]["Slot Data"];
  const edited = [submitted({ slot: 1, drink: MATCHA, new: 2 })];

  // Log rows the way rowsToObjects returns them
  let rowNumber;
  const row = (batchId, event, status = SAGA_STATUS.complete, slotDataText = "[]") => ({
    _rowNumber: rowNumber++,
    "Batch ID": batchId,
    Event: event,
    "Slot Data": slotDataText,
    Status: status,
  });
  const decide = (event, makeRows, submittedSlots = slots) => {
    rowNumber = 2;
    const rows = makeRows();
    return { rows, decision: decideSaga({ rows, batchId: BATCH, event, submittedSlots }) };
  };

  it("appends when the event has no row and the batch allows it", () => {
    expect(decide("Load", () => []).decision).toEqual({ action: "append" });
    expect(decide("Topoff", () => [row(BATCH, "Load")]).decision).toEqual({ action: "append" });
  });

  const rejections = [
    {
      name: "a batch that was already cleared out",
      event: "Topoff",
      rows: () => [row(BATCH, "Load"), row(BATCH, "Clearout")],
      expected: { action: "reject", status: 409, error: MESSAGES.batchClearedOut },
    },
    {
      name: "a Topoff before any Load",
      event: "Topoff",
      rows: () => [],
      expected: { action: "reject", status: 400, error: needsEventFirst("Load", "Topoff") },
    },
    {
      name: "a Topoff while the Load is still unfinished",
      event: "Topoff",
      rows: () => [row(BATCH, "Load", SAGA_STATUS.pending, storedSlotData)],
      expected: { action: "reject", status: 400, error: needsEventFirst("Load", "Topoff") },
    },
    {
      name: "a different submit for a Complete event",
      event: "Load",
      rows: () => [row(BATCH, "Load", SAGA_STATUS.complete, storedSlotData)],
      slots: edited,
      expected: { action: "reject", status: 409, error: MESSAGES.alreadySubmitted },
    },
  ];
  for (const c of rejections) {
    it(`rejects ${c.name}`, () => {
      expect(decide(c.event, c.rows, c.slots).decision).toEqual(c.expected);
    });
  }

  const resumes = [
    { status: SAGA_STATUS.pending, slots, expected: { action: "resume", from: "nayax", overwrite: false } },
    { status: SAGA_STATUS.nayaxWritten, slots, expected: { action: "resume", from: "inventory", overwrite: false } },
    { status: SAGA_STATUS.pending, slots: edited, expected: { action: "resume", from: "nayax", overwrite: true } },
    // Edited after Nayax was written: write Nayax again with the new totals
    { status: SAGA_STATUS.nayaxWritten, slots: edited, expected: { action: "resume", from: "nayax", overwrite: true } },
  ];
  for (const c of resumes) {
    it(`resumes a ${c.status} row at ${c.expected.from}${c.expected.overwrite ? " with the edited slots" : ""}`, () => {
      const { rows, decision } = decide("Load", () => [row(BATCH, "Load", c.status, storedSlotData)], c.slots);
      expect(decision).toEqual({ ...c.expected, row: rows[0] });
    });
  }

  it("treats a resend of a Complete submit as done, writing nothing", () => {
    const { rows, decision } = decide("Load", () => [row(BATCH, "Load", SAGA_STATUS.complete, storedSlotData)]);
    expect(decision).toEqual({ action: "done", row: rows[0] });
  });

  it("uses the first row for the event when there are two", () => {
    const { rows, decision } = decide("Load", () => [
      row(BATCH, "Load", SAGA_STATUS.pending, storedSlotData),
      row(BATCH, "Load", SAGA_STATUS.pending, storedSlotData),
    ]);
    expect(decision.row).toBe(rows[0]);
  });
});

/** A Nayax catalog product as GET /operators/{id}/products returns it. */
function catalogProduct(overrides) {
  return {
    NayaxProductID: 2002,
    ProductName: "Matcha 16oz Less Sweet",
    DEXProductName: "MATC_16_LESS",
    ProductCashPrice: 7,
    ProductCreditCardPrice: 7.25,
    ProductStatus: 1,
    ...overrides,
  };
}

describe("buildNayaxUpdate", () => {
  // The catalog decides which product a drink is. DEX name and prices come
  // from a machine slot already using that product, else from the catalog.
  const catalog = buildNayaxCatalog(
    [
      catalogProduct({ NayaxProductID: 3003, ProductName: "Matcha 16oz Less Sweet (2)" }), // a copy, listed first
      catalogProduct(),
      catalogProduct({ NayaxProductID: 1001, ProductName: "Thai Tea 16oz Less Sweet w/ Lychee", DEXProductName: null, ProductCashPrice: null, ProductCreditCardPrice: null }),
      catalogProduct({ NayaxProductID: 4004, ProductName: "Strawberry Matcha 16oz", DEXProductName: "SMAT_16", ProductCashPrice: 6.25, ProductCreditCardPrice: 6.25 }),
      catalogProduct({ NayaxProductID: 6006, ProductName: "Taro Tea 16oz", ProductStatus: 0 }),
      catalogProduct({ NayaxProductID: 7007, ProductName: "Black Tea 16oz", DEXProductName: null, ProductCashPrice: null, ProductCreditCardPrice: null }),
    ],
    // Another machine's slot already carries the Thai Tea product, with the
    // DEX name and prices the catalog entry lacks.
    [product({ MachineProductID: "other-8", NayaxProductID: 1001, MDBCode: 8, DEXProductName: "THAI_16_LESS_LYC", CashPrice: 6.5, CreditCardPrice: 6.5 })],
  );


  it("sends the whole machine in one PUT, with PAR = total and missing stock reset on changed slots", () => {
    const changed = product({ MachineProductID: "mp-1", MDBCode: 1, PAR: 4, MissingStockByMDB: 2 });
    const untouched = product({ MachineProductID: "mp-2", MDBCode: 2, PAR: 4, MissingStockByMDB: 1 });
    const outsideConfig = product({ MachineProductID: "mp-60", MDBCode: 60 });
    const plan = buildNayaxUpdate({
      event: "Topoff",
      currentProducts: [changed, untouched, outsideConfig],
      catalog,
      slots: [{ slot: 1, drink: THAI, total: 4 }],
    });
    // Full objects: a PUT replaces each product and drops anything left out
    expect(plan).toEqual({
      put: [{ ...changed, PAR: 4, MissingStockByMDB: 0 }, untouched, outsideConfig],
      post: [],
    });
  });

  it("skips the PUT when nothing differs", () => {
    const current = [product({ PAR: 3, MissingStockByMDB: 0 })];
    const plan = buildNayaxUpdate({
      event: "Topoff",
      currentProducts: current,
      catalog,
      slots: [{ slot: 1, drink: THAI, total: 3 }],
    });
    expect(plan).toEqual({ put: null, post: [] });
  });

  it("swaps the product ID, DEX name, and prices from the catalog when the drink changes", () => {
    const current = [product({ MDBCode: 1 })];
    const plan = buildNayaxUpdate({
      event: "Load",
      currentProducts: current,
      catalog,
      slots: [{ slot: 1, drink: MATCHA, total: 4 }],
    });
    expect(plan.put).toEqual([
      {
        ...current[0],
        NayaxProductID: 2002,
        DEXProductName: "MATC_16_LESS",
        CashPrice: 7,
        CreditCardPrice: 7.25,
        PAR: 4,
        MissingStockByMDB: 0,
      },
    ]);
  });

  it("creates a machine product for a slot Nayax does not have", () => {
    const plan = buildNayaxUpdate({
      event: "Load",
      currentProducts: [],
      catalog,
      slots: [{ slot: 50, drink: MATCHA, total: 3 }],
    });
    expect(plan.post).toEqual([
      {
        NayaxProductID: 2002,
        MDBCode: 50,
        PAR: 3,
        DEXProductName: "MATC_16_LESS",
        CashPrice: 7,
        CreditCardPrice: 7.25,
      },
    ]);
  });

  it("leaves an emptied slot out of the PUT and keeps every other product", () => {
    const keep = product({ MachineProductID: "mp-2", MDBCode: 2, PAR: 4, MissingStockByMDB: 1 });
    const outsideConfig = product({ MachineProductID: "mp-60", MDBCode: 60 });
    const emptied = product({ MachineProductID: "mp-1", MDBCode: 1 });
    const plan = buildNayaxUpdate({
      event: "Load",
      currentProducts: [emptied, keep, outsideConfig],
      catalog,
      slots: [
        { slot: 1, drink: null, total: 0 },
        { slot: 2, drink: THAI, total: 4 },
      ],
    });
    expect(plan).toEqual({
      put: [{ ...keep, PAR: 4, MissingStockByMDB: 0 }, outsideConfig],
      post: [],
    });
  });

  const create = (drink) =>
    buildNayaxUpdate({ event: "Load", currentProducts: [], catalog, slots: [{ slot: 50, drink, total: 2 }] }).post[0];

  it("takes DEX name and prices from a slot already using the product when the catalog lacks them", () => {
    expect(create(THAI)).toMatchObject({
      NayaxProductID: 1001,
      DEXProductName: "THAI_16_LESS_LYC",
      CashPrice: 6.5,
      CreditCardPrice: 6.5,
    });
  });

  it("creates a drink that is in the catalog but in no machine slot", () => {
    expect(create({ flavor: "Matcha", size: "16oz", topping: "Strawberry" })).toMatchObject({
      NayaxProductID: 4004,
      DEXProductName: "SMAT_16",
      CashPrice: 6.25,
      CreditCardPrice: 6.25,
    });
  });

  it("prefers the original product over a suffixed copy", () => {
    expect(create(MATCHA).NayaxProductID).toBe(2002);
  });

  it("ignores inactive catalog products", () => {
    expect(() => create({ flavor: "Taro Tea", size: "16oz" })).toThrow(
      /'Taro Tea 16oz Regular Sweetness' is not set up as a Nayax product/i,
    );
  });

  it("refuses a drink that is not in the catalog", () => {
    expect(() => create({ flavor: "Viet Latte", size: "16oz" })).toThrow(
      /'Viet Latte 16oz Regular Sweetness' is not set up as a Nayax product/i,
    );
  });

  it("refuses a product with no DEX name or prices anywhere", () => {
    expect(() => create({ flavor: "Black Tea", size: "16oz" })).toThrow(
      /'Black Tea 16oz Regular Sweetness' has no DEX name or prices in Nayax/i,
    );
  });
});
