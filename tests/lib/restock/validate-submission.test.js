// Unit tests for validateSubmission: the first check a POST meets, every
// slot rule and the event name.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMachineConfig } from "../../../src/lib/restock/config.js";
import { ERRORS, RestockError } from "../../../src/lib/restock/errors.js";
import { validateSubmission } from "../../../src/lib/restock/restock-log.js";
import { MATCHA, THAI, submitted } from "./fixtures.js";

describe("validateSubmission", () => {
  beforeEach(() => vi.stubEnv("RESTOCK_SLOTS_30TH", "1,2"));
  afterEach(() => vi.unstubAllEnvs());

  /** A POST body for 30th on 2026-07-10, with `overrides` applied last. */
  const ok = (event, slots, overrides = {}) => ({
    batchId: "30th-2026-07-10",
    event,
    slots,
    ...overrides,
  });
  const twoSlots = [submitted({ slot: 1 }), submitted({ slot: 2 })];

  const cases = [
    {
      name: "a body missing a field",
      input: ok("Load", twoSlots, { batchId: undefined }),
      error: ERRORS.missingFields.message,
    },
    {
      name: "a body whose slots is not a list",
      input: ok("Load", "1,2"),
      error: ERRORS.missingFields.message,
    },
    {
      name: "an unknown machine",
      input: ok("Load", twoSlots, { batchId: "Depot-2026-07-10" }),
      error: ERRORS.unknownMachine("Depot").message,
    },
    {
      name: "a valid Load",
      input: ok("Load", [
        submitted({
          slot: 1,
          drink: MATCHA,
          previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee",
          previous: 2,
          waste: 2,
          new: 4,
        }),
        submitted({ slot: 2 }),
      ]),
      error: null,
    },
    {
      name: "a Load that leaves old drinks in the slot",
      input: ok("Load", [
        submitted({
          slot: 1,
          drink: MATCHA,
          previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee",
          previous: 3,
          waste: 2,
          new: 1,
        }),
        submitted({ slot: 2 }),
      ]),
      error: /slot 1: a Load must take out all 3 previous/i,
    },
    {
      name: "a missing slot",
      input: ok("Load", [
        submitted({
          slot: 1,
          previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee",
          previous: 2,
          waste: 2,
        }),
      ]),
      error: /slot 2 is missing/i,
    },
    {
      name: "a duplicated slot",
      input: ok("Load", [
        submitted({
          slot: 1,
          previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee",
          previous: 2,
          waste: 2,
        }),
        submitted({
          slot: 1,
          previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee",
          previous: 2,
          waste: 2,
        }),
      ]),
      error: /slot 1 appears more than once/i,
    },
    {
      name: "a slot the machine does not have",
      input: ok("Load", [
        submitted({
          slot: 1,
          previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee",
          previous: 2,
          waste: 2,
        }),
        submitted({ slot: 2 }),
        submitted({ slot: 36 }),
      ]),
      error: /slot 36 is not configured/i,
    },
    {
      name: "a negative count",
      input: ok("Load", [
        submitted({
          slot: 1,
          previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee",
          previous: 2,
          waste: 2,
          new: -1,
        }),
        submitted({ slot: 2 }),
      ]),
      error: /slot 1: new must be a non-negative integer/i,
    },
    {
      name: "new over the slot's headroom",
      input: ok("Topoff", [
        submitted({
          slot: 1,
          drink: THAI,
          previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee",
          previous: 3,
          waste: 0,
          new: 2,
        }),
        submitted({ slot: 2 }),
      ]),
      error: /slot 1: new 2 exceeds the 1 free/i,
    },
    {
      name: "Topoff waste above the Nayax count",
      input: ok("Topoff", [
        submitted({
          slot: 1,
          drink: THAI,
          previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee",
          previous: 3,
          waste: 4,
          new: 0,
        }),
        submitted({ slot: 2 }),
      ]),
      error: /slot 1: waste 4 exceeds previous 3/i,
    },
    {
      name: "Topoff waste above a corrected previous count",
      input: ok("Topoff", [
        submitted({
          slot: 1,
          drink: THAI,
          previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee",
          previous: 2,
          waste: 3,
          new: 0,
        }),
        submitted({ slot: 2 }),
      ]),
      error: /slot 1: waste 3 exceeds previous 2/i,
    },
    {
      name: "a Topoff whose corrected previous count frees more space",
      // Nayax says 3 (1 free); really 2, so 2 new fit.
      input: ok("Topoff", [
        submitted({
          slot: 1,
          drink: THAI,
          previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee",
          previous: 2,
          waste: 0,
          new: 2,
        }),
        submitted({ slot: 2 }),
      ]),
      error: null,
    },
    {
      name: "a Topoff that swaps the drink",
      input: ok("Topoff", [
        submitted({
          slot: 1,
          drink: MATCHA,
          previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee",
          previous: 3,
          waste: 0,
          new: 1,
        }),
        submitted({ slot: 2 }),
      ]),
      error: /slot 1: a Topoff cannot change the drink/i,
    },
    {
      name: "a Topoff that corrects the previous drink and keeps it",
      input: ok("Topoff", [
        submitted({
          slot: 1,
          drink: MATCHA,
          previousDrink: "Matcha 16oz Less Sweet",
          previous: 3,
          waste: 0,
          new: 1,
        }),
        submitted({ slot: 2 }),
      ]),
      error: null,
    },
    {
      name: "a slot with no drink that still holds drinks",
      // Would delete the Nayax product while logging Total 3
      input: ok("Topoff", [
        submitted({
          slot: 1,
          previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee",
          previous: 3,
          waste: 0,
          new: 0,
        }),
        submitted({ slot: 2 }),
      ]),
      error: /slot 1: a slot with no drink must end at 0, not 3/i,
    },
    {
      name: "an event that is not Load, Topoff or Clearout",
      input: ok("load", [submitted({ slot: 1 }), submitted({ slot: 2 })]),
      error: /unknown event load/,
    },
  ];

  for (const c of cases) {
    it(`${c.error ? "rejects" : "accepts"} ${c.name}`, () => {
      if (!c.error) {
        expect(validateSubmission(c.input)).toBe(getMachineConfig("30th"));
        return;
      }
      let thrown;
      try {
        validateSubmission(c.input);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(RestockError);
      expect(thrown.status).toBe(400);
      expect(thrown.message).toMatch(c.error);
    });
  }
});
