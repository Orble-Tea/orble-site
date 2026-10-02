// Unit tests for the edit-screen count rules and the POST slot shape.
// The browser tests only check that the steppers are wired to these.
import { describe, expect, it } from "vitest";
import {
  emptyCounts,
  newCeiling,
  restoreDraftEntry,
  setNew,
  setPrevious,
  setWaste,
  shownPrevious,
  slotTotal,
  toSubmitSlot,
} from "../../../src/lib/restock/ui-helpers.ts";

const counts = (previous, waste, newCount) => ({ previous, waste, newCount });

describe("waste stepper", () => {
  it("on Load and Clearout, previous and waste move together because everything comes out", () => {
    const load = setWaste(counts(2, 2, 4), 3, "Load", 4);
    expect(shownPrevious(load, "Load")).toBe(3);
    expect(slotTotal(load, "Load")).toBe(4); // 3 - 3 + 4
    expect(setPrevious(counts(2, 2, 4), 1, "Load", 4).waste).toBe(1);

    const clearout = setWaste(counts(2, 2, 0), 1, "Clearout", 4);
    expect(shownPrevious(clearout, "Clearout")).toBe(1);
    expect(slotTotal(clearout, "Clearout")).toBe(0);
  });

  it("on Topoff, waste is capped at the previous count", () => {
    expect(setWaste(counts(3, 0, 1), 5, "Topoff", 4).waste).toBe(3);
    expect(shownPrevious(counts(3, 1, 1), "Topoff")).toBe(3);
  });

  it("on Topoff, lowering waste pulls new down so the slot never overfills", () => {
    // 3 in the slot, 3 wasted, 4 new; waste back to 1 leaves 2 in: new fits 2.
    expect(setWaste(counts(3, 3, 4), 1, "Topoff", 4)).toEqual(counts(3, 1, 2));
  });

  it("never goes below zero", () => {
    expect(setWaste(counts(2, 0, 0), -1, "Topoff", 4).waste).toBe(0);
    expect(setWaste(counts(2, 2, 0), -1, "Load", 4).waste).toBe(0);
  });
});

describe("previous stepper", () => {
  it("on Topoff, corrects the Nayax count in either direction with no ceiling", () => {
    expect(setPrevious(counts(3, 0, 1), 2, "Topoff", 4).previous).toBe(2);
    expect(setPrevious(counts(3, 0, 1), 6, "Topoff", 4).previous).toBe(6);
    expect(setPrevious(counts(3, 0, 1), -1, "Topoff", 4).previous).toBe(0);
  });

  it("on Topoff, lowering previous pulls waste down with it", () => {
    expect(setPrevious(counts(3, 3, 0), 2, "Topoff", 4)).toEqual(counts(2, 2, 0));
  });

  it("on Topoff, raising previous shrinks the free space for new", () => {
    // 2 in the slot + 2 new fills it; Nayax was wrong and there are 3: new fits 1.
    expect(setPrevious(counts(2, 0, 2), 3, "Topoff", 4)).toEqual(counts(3, 0, 1));
  });
});

describe("new stepper", () => {
  it("on Load, the whole slot is free because the old batch comes out", () => {
    expect(newCeiling(counts(3, 3, 0), "Load", 4)).toBe(4);
  });

  it("on Topoff, the ceiling is capacity minus what stays in the slot", () => {
    expect(newCeiling(counts(3, 1, 0), "Topoff", 4)).toBe(2);
    expect(setNew(counts(3, 1, 0), 3, "Topoff", 4).newCount).toBe(2);
  });

  it("never goes negative when Nayax reports more than capacity", () => {
    expect(newCeiling(counts(5, 0, 0), "Topoff", 4)).toBe(0);
  });
});

describe("Empty", () => {
  it("on Topoff, takes everything out and adds nothing", () => {
    expect(emptyCounts(counts(3, 1, 2), "Topoff")).toEqual(counts(3, 3, 0));
  });

  it("on Load, keeps the waste count and adds nothing", () => {
    expect(emptyCounts(counts(2, 3, 4), "Load")).toEqual(counts(2, 3, 0));
  });
});

describe("toSubmitSlot", () => {
  // The POST carries the full state the restocker confirmed, so the log
  // records what they saw even if Nayax or the plan changed mid-visit.
  const slot = {
    slot: 1,
    previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee",
    flavor: "Matcha",
    size: "16oz",
    topping: "Lychee",
    sweetness: "Less Sweet",
    previous: 3,
    waste: 3,
    expectedNew: 3,
    total: 3,
    newCount: 4,
  };

  it("sends the drink, previous drink, and all three counts for every slot", () => {
    expect(toSubmitSlot(slot, "Topoff")).toEqual({
      slot: 1,
      drink: { flavor: "Matcha", size: "16oz", topping: "Lychee", sweetness: "Less Sweet" },
      previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee",
      previous: 3,
      waste: 3,
      new: 4,
    });
  });

  it("sends drink: null for an Empty slot", () => {
    expect(
      toSubmitSlot(
        { ...slot, flavor: null, size: null, topping: null, sweetness: null, newCount: 0 },
        "Load",
      ).drink,
    ).toBeNull();
  });

  it("on Load and Clearout, sends previous equal to waste", () => {
    expect(toSubmitSlot({ ...slot, previous: 2, waste: 4 }, "Load")).toMatchObject({
      previous: 4,
      waste: 4,
    });
    expect(toSubmitSlot({ ...slot, previous: 2, waste: 1, newCount: 0 }, "Clearout")).toMatchObject({
      previous: 1,
      waste: 1,
    });
  });
});

describe("restoreDraftEntry", () => {
  it("reads drafts saved before the sweetness rename", () => {
    const entry = restoreDraftEntry(
      { slot: 1, waste: 0, newCount: 2, sweetnessLevel: "Less Sweet" },
      { previous: 3 },
      "Topoff",
    );
    expect(entry.sweetness).toBe("Less Sweet");
    expect(entry).not.toHaveProperty("sweetnessLevel");
  });

  it("keeps a corrected previous count saved in the draft", () => {
    expect(
      restoreDraftEntry({ slot: 1, previous: 2, waste: 1, newCount: 0 }, { previous: 3 }, "Topoff"),
    ).toMatchObject({ previous: 2, waste: 1 });
  });

  it("clamps a Topoff draft whose waste was allowed above previous by the old rule", () => {
    expect(
      restoreDraftEntry({ slot: 1, waste: 4, newCount: 0 }, { previous: 3 }, "Topoff")
        .waste,
    ).toBe(3);
  });
});
