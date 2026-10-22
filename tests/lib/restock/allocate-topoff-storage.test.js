// Storage allocation across slots: level the slots that hold the drink, then
// open empty slots for a leftover of EMPTY_SLOT_MIN_FILL or more.
import { describe, expect, it } from "vitest";
import {
  allocateTopoffStorage,
  emptySlotCandidate,
} from "../../../src/lib/restock/restock-sheets.js";
import { DEFAULT_DRINK_SLOT_CAPACITY } from "../../../src/lib/restock/drink-parsing.js";

const THAI = "thai tea|16oz|less sweet|lychee";

function candidate(machineLabel, slot, previous, drinkKey = THAI) {
  return {
    machineLabel,
    slot: { slot, previous },
    drinkKey,
    capacityLeft: DEFAULT_DRINK_SLOT_CAPACITY - previous,
    allocation: 0,
  };
}

describe("allocateTopoffStorage", () => {
  it("fills existing slots first, then opens an empty slot for a leftover of 2 or more", () => {
    const existing = [candidate("30th", 1, 2), candidate("Towne", 1, 1)];
    const empties = [
      emptySlotCandidate("Towne", 3),
      emptySlotCandidate("30th", 5),
    ];

    allocateTopoffStorage(new Map([[THAI, 9]]), existing, empties);

    expect(existing.map((c) => c.allocation)).toEqual([2, 3]);
    const opened = empties.find((c) => c.machineLabel === "30th");
    expect(opened).toMatchObject({ drinkKey: THAI, allocation: 4 });
    expect(empties.find((c) => c.machineLabel === "Towne")).toMatchObject({
      drinkKey: "",
      allocation: 0,
    });
  });

  it("leaves a leftover of 1 in the fridge", () => {
    const existing = [candidate("30th", 1, 2)];
    const empties = [emptySlotCandidate("30th", 5)];

    allocateTopoffStorage(new Map([[THAI, 3]]), existing, empties);

    expect(existing[0].allocation).toBe(2);
    expect(empties[0]).toMatchObject({ drinkKey: "", allocation: 0 });
  });

  it("fills one opened slot before opening another, so 5 left becomes 4 and 1 in the fridge", () => {
    const existing = [candidate("30th", 1, 4)];
    const empties = [
      emptySlotCandidate("30th", 5),
      emptySlotCandidate("Towne", 2),
    ];

    allocateTopoffStorage(new Map([[THAI, 5]]), existing, empties);

    expect(empties.map((c) => c.allocation)).toEqual([4, 0]);
  });

  it("opens a second empty slot when the first fills and 2 or more remain", () => {
    const existing = [candidate("30th", 1, 4)];
    const empties = [
      emptySlotCandidate("30th", 5),
      emptySlotCandidate("Towne", 2),
    ];

    allocateTopoffStorage(new Map([[THAI, 7]]), existing, empties);

    expect(empties.map((c) => c.allocation)).toEqual([4, 3]);
  });
});
