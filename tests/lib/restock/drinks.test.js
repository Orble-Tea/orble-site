import { describe, expect, it } from "vitest";

import {
  BOBA_PACK_SLOT_CAPACITY,
  canonicalDrinkKey,
  DEFAULT_DRINK_SLOT_CAPACITY,
  expandNayaxDrinkCode,
  parseDrinkName,
  slotCapacityForDrink,
} from "../../../src/lib/restock/drinks.js";

describe("drink parsing", () => {
  it("parses a full drink variation into restock slot fields", () => {
    expect(parseDrinkName("Thai Tea Less Sweet w/ Lychee 16oz")).toEqual({
      flavor: "Thai Tea",
      size: "16oz",
      topping: "Lychee",
      sweetness: "Less Sweet",
    });
  });

  it("expands Nayax product codes into sheet-style drink names", () => {
    expect(expandNayaxDrinkCode("THAI_16_LESS_LYC")).toBe(
      "Thai Tea 16oz Less Sugar w/ Lychee",
    );
    expect(expandNayaxDrinkCode("MANG_16_REG_LYC")).toBe(
      "Mango Passion Fruit Tea 16oz w/ Lychee",
    );
  });

  it("uses the same canonical key for Nayax codes and sheet drink names", () => {
    expect(canonicalDrinkKey("THAI_16_LESS_LYC")).toBe(
      canonicalDrinkKey("Thai Tea 16oz Less Sugar w/ Lychee"),
    );
    expect(canonicalDrinkKey("MANG_16_REG_LYC")).toBe(
      canonicalDrinkKey("Mango Passion Fruit Tea 16oz w/ Lychee"),
    );
  });

  it("uses higher slot capacity for boba packs", () => {
    expect(slotCapacityForDrink("Boba Pack")).toBe(BOBA_PACK_SLOT_CAPACITY);
    expect(slotCapacityForDrink("Thai Tea Less Sweet 16oz")).toBe(
      DEFAULT_DRINK_SLOT_CAPACITY,
    );
  });
});
