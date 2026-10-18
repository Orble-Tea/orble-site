// Unit tests for the Restock Log row builders: the rows a submit writes, the
// Slot Data rewrite on a resend, and what counts as the same slots.
import { describe, expect, it } from "vitest";
import { RESTOCK_LOG_HEADER } from "../../../src/lib/restock/config.js";
import {
  SUBMIT_STATUS,
  buildRestockLogRows,
  sameSlots,
} from "../../../src/lib/restock/restock-log.js";
import { MATCHA, THAI, expected, submitted } from "./fixtures.js";

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
  const slotData = (row) => JSON.parse(row["Slot Data"] || "[]");

  it("writes a Load as a Clearout row closing the old batch and a Load row, sharing every slot", () => {
    const rows = buildRestockLogRows({
      ...base,
      event: "Load",
      submittedSlots: [
        submitted({
          slot: 1,
          drink: THAI,
          previousDrink: "Mango Passion Fruit Tea 16oz",
          previous: 3,
          waste: 3,
          new: 3,
          expected: expected({
            drink: THAI,
            previousDrink: "Taro Tea 16oz",
            previous: 2,
            waste: 2,
            new: 4,
          }),
        }),
        submitted({ slot: 2 }),
      ],
      status: SUBMIT_STATUS.NAYAX_PENDING,
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
    expect(rows.map((row) => Object.keys(row))).toEqual([
      Object.values(RESTOCK_LOG_HEADER),
      Object.values(RESTOCK_LOG_HEADER),
    ]);
    expect(rows.map(({ "Slot Data": _slotData, ...rest }) => rest)).toEqual([
      {
        "Batch ID": "Towne-2026-07-03",
        Event: "Clearout",
        Date: "2026-07-10",
        Duration: "5m 32s",
        Status: SUBMIT_STATUS.NAYAX_PENDING,
      },
      {
        "Batch ID": "Towne-2026-07-10",
        Event: "Load",
        Date: "2026-07-10",
        Duration: "5m 32s",
        Status: SUBMIT_STATUS.NAYAX_PENDING,
      },
    ]);
    expect(slotData(rows[0])).toEqual(slots);
    expect(slotData(rows[1])).toEqual(slots);
  });

  it("writes only the Load row when the machine has no earlier batch", () => {
    const rows = buildRestockLogRows({
      ...base,
      previousBatchId: null,
      event: "Load",
      submittedSlots: [
        submitted({
          slot: 1,
          drink: MATCHA,
          new: 4,
          expected: expected({ drink: MATCHA, new: 4 }),
        }),
      ],
      status: SUBMIT_STATUS.NAYAX_PENDING,
    });
    expect(rows.map((row) => row.Event)).toEqual(["Load"]);
  });

  it("writes one Topoff row with the corrected previous count next to the Nayax count", () => {
    const rows = buildRestockLogRows({
      ...base,
      event: "Topoff",
      visitDate: "2026-07-13",
      submittedSlots: [
        submitted({
          slot: 1,
          drink: THAI,
          previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee",
          previous: 1,
          waste: 0,
          new: 3,
          expected: expected({
            drink: THAI,
            previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee",
            previous: 2,
            new: 2,
          }),
        }),
      ],
      status: SUBMIT_STATUS.NAYAX_PENDING,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      "Batch ID": "Towne-2026-07-10",
      Event: "Topoff",
      Date: "2026-07-13",
    });
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
        submitted({
          slot: 1,
          drink: MATCHA,
          previousDrink: "Taro Tea 16oz",
          new: 4,
          expected: expected({
            drink: MATCHA,
            previousDrink: "Taro Tea 16oz",
            new: 4,
          }),
        }),
        submitted({ slot: 2 }),
      ],
      status: SUBMIT_STATUS.NAYAX_PENDING,
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
      submitted({
        slot: 1,
        drink: THAI,
        previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee",
        previous: 2,
        waste: 1,
        new: 2,
      }),
      submitted({ slot: 2 }),
    ],
    status: SUBMIT_STATUS.NAYAX_PENDING,
  })[0];
  const entries = JSON.parse(stored["Slot Data"] || "[]");
  const resubmit = (slot1) => [
    submitted({
      slot: 1,
      drink: THAI,
      previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee",
      previous: 2,
      waste: 1,
      new: 2,
      ...slot1,
    }),
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
    expect(
      sameSlots(resubmit({ previousDrink: "Matcha 16oz Less Sweet" }), entries),
    ).toBe(false);
  });
});
