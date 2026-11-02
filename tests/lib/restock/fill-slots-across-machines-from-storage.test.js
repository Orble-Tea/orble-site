// Storage allocation across slots: level the slots that hold the drink, then
// open empty slots for a leftover of half a slot or more.
import { describe, expect, it } from "vitest";
import {
  fillSlotsAcrossMachinesFromStorage,
  getTopoffCandidates,
} from "../../../src/lib/restock/restock-sheets.js";

const THAI = "thai tea|16oz";
const MATCHA = "matcha|16oz";
const TARO = "taro tea|16oz";
const MANGO = "mango passion fruit tea|16oz";
const BLACK = "black tea|16oz";
const HORCHATA = "horchata|16oz";

function filled(slot, drinkKey, previous) {
  return {
    slotNumber: slot,
    previous,
    flavor: drinkKey.split("|")[0],
    size: "16oz",
    hasCurrentProduct: true,
  };
}

function empty(slot) {
  return { slotNumber: slot, previous: 0, hasCurrentProduct: false };
}

function forMachine(slotAllocations, machineLabel) {
  return slotAllocations
    .filter((a) => a.machineLabel === machineLabel)
    .map((a) => [a.slotNumber, a.drinkKey, a.allocation]);
}

describe("fillSlotsAcrossMachinesFromStorage", () => {
  it("levels the slots that hold each drink, then opens empty slots only on machines that already hold it", () => {
    const list = [
      ...getTopoffCandidates({ label: "30th" }, [
        filled(1, THAI, 2),
        filled(2, MATCHA, 3),
        filled(3, MANGO, 2),
        empty(4),
      ]),
      ...getTopoffCandidates({ label: "Towne" }, [
        filled(1, MATCHA, 1),
        filled(2, TARO, 2),
        filled(3, BLACK, 3),
        filled(4, MANGO, 1),
        empty(5),
        empty(6),
      ]),
    ];

    const slotAllocations = fillSlotsAcrossMachinesFromStorage(
      new Map([
        [THAI, 2],
        [MATCHA, 3],
        [TARO, 3],
        [BLACK, 3],
        [MANGO, 11],
        [HORCHATA, 5],
      ]),
      list,
    );

    expect(list.every((c) => c.allocation === 0)).toBe(true);
    expect(forMachine(slotAllocations, "30th")).toEqual([
      [1, THAI, 2],
      [3, MANGO, 2],
      [4, MANGO, 4],
    ]);
    expect(forMachine(slotAllocations, "Towne")).toEqual([
      [1, MATCHA, 3],
      [2, TARO, 2],
      [3, BLACK, 1],
      [4, MANGO, 3],
      [5, BLACK, 2],
      [6, MANGO, 2],
    ]);
  });
});
