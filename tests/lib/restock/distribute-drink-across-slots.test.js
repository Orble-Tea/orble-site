import { describe, expect, it } from "vitest";
import { distributeDrinkAcrossSlots } from "../../../src/lib/restock/restock-sheets.js";

describe("distributeDrinkAcrossSlots", () => {
  it("gives each cup to the slot with the fewest, so uneven slots level out", () => {
    expect(
      distributeDrinkAcrossSlots(2, [
        { start: 3, capacity: 4 },
        { start: 1, capacity: 4 },
      ]),
    ).toEqual([0, 2]);
  });

  it("breaks a level tie by the slot that started emptier, then list order", () => {
    expect(
      distributeDrinkAcrossSlots(3, [
        { start: 3, capacity: 4 },
        { start: 1, capacity: 4 },
      ]),
    ).toEqual([0, 3]);
    expect(
      distributeDrinkAcrossSlots(3, [
        { start: 0, capacity: 4 },
        { start: 0, capacity: 4 },
      ]),
    ).toEqual([2, 1]);
  });

  it("stops at capacity and leaves the rest", () => {
    expect(
      distributeDrinkAcrossSlots(9, [
        { start: 0, capacity: 4 },
        { start: 2, capacity: 4 },
      ]),
    ).toEqual([4, 2]);
    expect(distributeDrinkAcrossSlots(5, [])).toEqual([]);
  });
});
