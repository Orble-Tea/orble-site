import { describe, expect, it } from "vitest";

import {
  BOBA_PACK_SLOT_CAPACITY,
  canonicalDrinkKey,
  canonicalDrinkKeyFromParts,
  canonicalDrinkKeyFromSlot,
  DEFAULT_DRINK_SLOT_CAPACITY,
  describeInvalidDrink,
  expandNayaxDrinkCode,
  formatDrinkName,
  isValidDrink,
  parseDrinkName,
  slotCapacityForDrink,
  slotCapacityForDrinkParts,
} from "../../../src/lib/restock/drink-parsing.js";
import { MATCHA, THAI } from "./fixtures.js";

describe("drink parsing", () => {
  it.each([
    // name, flavor, size, sweetness, topping, unknown, verdict
    [
      "Thai Tea Less Sweet w/ Lychee 16oz",
      "Thai Tea",
      "16oz",
      "Less Sweet",
      "Lychee",
      null,
      "",
    ],
    ["Matcha 16oz Less Sweet", "Matcha", "16oz", "Less Sweet", null, null, ""],
    ["Matcha Less Sweet 16oz", "Matcha", "16oz", "Less Sweet", null, null, ""],
    [
      "Thai Tea 22 oz less sweet",
      "Thai Tea",
      "22oz",
      "Less Sweet",
      null,
      null,
      "",
    ],
    [
      "Matcha 16oz with Strawberry",
      "Matcha",
      "16oz",
      null,
      "Strawberry",
      null,
      "",
    ],
    ["Strawberry Matcha 16oz", "Matcha", "16oz", null, "Strawberry", null, ""],
    [
      "Mango Passion Fruit Tea 16oz Regular Sweetness w/ Lychee",
      "Mango Passion Fruit Tea",
      "16oz",
      null,
      "Lychee",
      null,
      "",
    ],
    ["THAI_16_LESS_LYC", "Thai Tea", "16oz", "Less Sweet", "Lychee", null, ""],
    [
      "Matcha 16oz Less Sugar",
      "Matcha",
      "16oz",
      null,
      null,
      "Less Sugar",
      'unrecognized "Less Sugar"',
    ],
    [
      "Taro Tea 22oz LessSweet",
      "Taro Tea",
      "22oz",
      null,
      null,
      "LessSweet",
      'unrecognized "LessSweet"',
    ],
    [
      "Thai Tea 24oz Less Sweet",
      "Thai Tea",
      null,
      "Less Sweet",
      null,
      "24oz",
      'unrecognized "24oz", missing or invalid size',
    ],
    ["MATC_16_LSS", "Matcha", "16oz", null, null, "LSS", 'unrecognized "LSS"'],
    [
      "Matcha with Strawberry",
      "Matcha",
      null,
      null,
      "Strawberry",
      null,
      "missing or invalid size",
    ],
    ["Taro 16oz", null, "16oz", null, null, "Taro", 'unrecognized "Taro", missing flavor'],
    [
      "BMT22",
      null,
      null,
      null,
      null,
      "BMT22",
      'unrecognized "BMT22", missing flavor, missing or invalid size',
    ],
  ])(
    "parses %j",
    (name, flavor, size, sweetness, topping, unknown, verdict) => {
      const parsed = parseDrinkName(name);
      expect(parsed).toEqual({ flavor, size, sweetness, topping, unknown });
      expect(isValidDrink(parsed)).toBe(verdict === "");
      expect(describeInvalidDrink(parsed)).toBe(verdict);
    },
  );

  it("expands Nayax product codes into sheet-style drink names", () => {
    expect(expandNayaxDrinkCode("THAI_16_LESS_LYC")).toBe(
      "Thai Tea 16oz Less Sweet w/ Lychee",
    );
    expect(expandNayaxDrinkCode("MANG_16_REG_LYC")).toBe(
      "Mango Passion Fruit Tea 16oz Regular Sweetness w/ Lychee",
    );
    expect(expandNayaxDrinkCode("MATC_16_LSS")).toBe(
      "Matcha 16oz Regular Sweetness LSS",
    );
  });

  it("uses the same canonical key for Nayax codes and sheet drink names", () => {
    expect(canonicalDrinkKey("THAI_16_LESS_LYC")).toBe(
      canonicalDrinkKey("Thai Tea 16oz Less Sweet w/ Lychee"),
    );
    expect(canonicalDrinkKey("SMAT_16_REG")).toBe(
      canonicalDrinkKey("Matcha 16oz with Strawberry"),
    );
    expect(canonicalDrinkKey("Matcha 16oz Less Sugar")).toBe("");
  });

  it("uses the same canonical key for parsed drink parts", () => {
    const parsed = parseDrinkName("Thai Tea 16oz Less Sweet w/ Lychee");
    expect(canonicalDrinkKeyFromParts(parsed)).toBe(
      canonicalDrinkKey("THAI_16_LESS_LYC"),
    );
    expect(
      canonicalDrinkKeyFromSlot({
        flavor: "Thai Tea",
        size: "16oz",
        sweetness: "Less Sweet",
        topping: "Lychee",
      }),
    ).toBe(canonicalDrinkKey("THAI_16_LESS_LYC"));
  });

  it("uses higher slot capacity for boba packs", () => {
    expect(slotCapacityForDrink("Boba Pack")).toBe(BOBA_PACK_SLOT_CAPACITY);
    expect(slotCapacityForDrinkParts({ flavor: "Boba Pack" })).toBe(
      BOBA_PACK_SLOT_CAPACITY,
    );
    expect(slotCapacityForDrink("Thai Tea Less Sweet 16oz")).toBe(
      DEFAULT_DRINK_SLOT_CAPACITY,
    );
  });
});

describe("formatDrinkName", () => {
  it("formats drink parts the way Nayax codes expand", () => {
    expect(formatDrinkName(THAI)).toBe("Thai Tea 16oz Less Sweet w/ Lychee");
    expect(formatDrinkName(MATCHA)).toBe("Matcha 16oz Less Sweet");
    expect(formatDrinkName({ flavor: null })).toBe("");
  });
});
