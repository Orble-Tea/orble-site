import { describe, expect, it } from "vitest";

import {
  isBobaPack,
  normalizeDrinkName,
  parseDrinkName,
  slotCapacityForDrink,
} from "./drinks.js";

describe("drink helpers", () => {
  it("normalizes repeated whitespace in drink names", () => {
    expect(normalizeDrinkName("  Thai   Tea   Less Sweet  16oz ")).toBe(
      "Thai Tea Less Sweet 16oz",
    );
  });

  it("parses flavor, sweetness, topping, and size from a full variation", () => {
    expect(parseDrinkName("Thai Tea Less Sweet w/ Lychee 16oz")).toEqual({
      flavor: "Thai Tea",
      sweetness: "Less Sweet",
      topping: "Lychee",
      size: "16oz",
    });
  });

  it("handles variations without a topping", () => {
    expect(parseDrinkName("Taro Normal 22oz")).toEqual({
      flavor: "Taro",
      sweetness: "Normal",
      topping: null,
      size: "22oz",
    });
  });

  it("uses larger capacity for boba packs only", () => {
    expect(isBobaPack("Brown Sugar Boba Pack")).toBe(true);
    expect(slotCapacityForDrink("Brown Sugar Boba Pack")).toBe(6);
    expect(slotCapacityForDrink("Brown Sugar Milk Tea w/ Boba 16oz")).toBe(4);
  });
});
