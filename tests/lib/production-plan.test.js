import { describe, expect, it } from "vitest";
import {
  parseProductionPlan,
  parseSlots,
  validatedProductionPlanValues,
} from "../../src/lib/production-plan.js";

export const HEADERS = [
  "Recipe",
  "Drink Variation",
  "Amount to Make",
  "Amount to 30th",
  "Slot (30th)",
  "Amount to Towne",
  "Slot (Towne)",
];
export const validPlan = () => [
  HEADERS,
  ["Tea", "Thai Tea 16oz", 8, 4, "1", 4, "2"],
];

describe("shared production plan validation", () => {
  it.each([2, 8, 31])(
    "recognizes the totals row after %s drink rows",
    (drinkCount) => {
      const values = [
        [...HEADERS, "Total Stickers"],
        ...Array.from({ length: drinkCount }, (_, index) => [
          "Tea",
          `Tea ${index} 16oz`,
          1,
          0,
          "",
          0,
          "",
          1,
        ]),
        [],
        ["", "", drinkCount, "", "", "", "", drinkCount],
        ["Catering"],
        ["Tea", "Catering drink", "not a batch quantity"],
      ];
      const plan = parseProductionPlan(values);
      expect(plan).toHaveLength(drinkCount);
      expect(plan.at(-1).rowNumber).toBe(drinkCount + 1);
    },
  );

  it("keeps rejecting unnamed machine allocations beside totals", () => {
    const values = [
      [...HEADERS, "Total Stickers"],
      ["Tea", "Tea 16oz", 1, 0, "", 0, "", 1],
      ["", "", 1, 1, "1", "", "", 1],
    ];
    expect(() => parseProductionPlan(values)).toThrow(
      "Allocation has no Drink Variation",
    );
  });

  it("parses both machines and preserves source rows and recipe inheritance", () => {
    const values = [
      HEADERS,
      ["Tea"],
      [],
      ["", "Thai Tea 16oz", 8, 4, "1", 4, "2"],
      ["Catering"],
      ["", "Ignored", "bad"],
    ];
    expect(parseProductionPlan(values)).toEqual([
      expect.objectContaining({
        rowNumber: 4,
        recipe: "Tea",
        variation: "Thai Tea 16oz",
        cupsToMachine: 8,
        machineSlots: { "30th": [1], Towne: [2] },
      }),
    ]);
  });

  it.each([
    ["negative", 2, -1, "INVALID_QUANTITY"],
    ["decimal", 3, 1.5, "INVALID_QUANTITY"],
    ["partial integer", 3, "3cups", "INVALID_QUANTITY"],
    ["blank allocation", 5, "", "INVALID_QUANTITY"],
    ["missing slots", 4, "", "MISSING_SLOTS"],
    ["zero slot", 4, "0", "INVALID_SLOTS"],
    ["large slot", 4, "36", "INVALID_SLOTS"],
    ["bad token", 4, "1, nope", "INVALID_SLOTS"],
    ["date", 4, new Date(), "INVALID_SLOTS"],
    ["repeated slot", 4, "1,1", "DUPLICATE_SLOT"],
    ["capacity", 3, 5, "SLOT_CAPACITY"],
    ["overallocated", 2, 7, "OVERALLOCATED"],
  ])("rejects %s", (_, column, value, code) => {
    const plan = validPlan();
    plan[1][column] = value;
    try {
      parseProductionPlan(plan);
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error.issues).toContainEqual(
        expect.objectContaining({ code, rowNumber: 2 }),
      );
    }
  });

  it("rejects conflicts in either machine even when a consumer only needs one", () => {
    const values = validPlan();
    values.push(["Tea", "Matcha 16oz", 4, 0, "", 4, "2"]);
    expect(() => parseProductionPlan(values)).toThrow("Duplicate Towne slot 2");
  });

  it("rejects missing headers, duplicate headers, empty plans and orphan allocations", () => {
    expect(() => parseProductionPlan([])).toThrow("Missing column");
    expect(() => parseProductionPlan([HEADERS])).toThrow("no drink rows");
    expect(() => parseProductionPlan([[...HEADERS, "amount to make"]])).toThrow(
      "Duplicate column",
    );
    const values = validPlan();
    values.push(["", "", 3, 0, "", 0, ""]);
    expect(() => parseProductionPlan(values)).toThrow("no Drink Variation");
  });

  it("rejects duplicate drink names", () => {
    const values = validPlan();
    values.push(["Tea", "thai tea 16oz", 0, 0, "", 0, ""]);
    expect(() => parseProductionPlan(values)).toThrow("Duplicate variation");
  });

  it.each([0, 4, 23])(
    "validates Boba Pack at changing batch positions (%s blank rows)",
    (blankRows) => {
      const values = [
        HEADERS,
        ["Tea", "Thai Tea 16oz", 4, 4, "1", 0, ""],
        ...Array.from({ length: blankRows }, () => []),
        ["Topping", "bObA PaCk", 12, 6, "2", 6, "1"],
        ["Tea", "Matcha 16oz", 4, 0, "", 4, "2"],
        ["Catering"],
      ];
      const plan = parseProductionPlan(values);
      expect(plan.map((item) => item.variation)).toEqual([
        "Thai Tea 16oz",
        "bObA PaCk",
        "Matcha 16oz",
      ]);
      expect(plan[1]).toMatchObject({
        recipe: "Topping",
        rowNumber: blankRows + 3,
        amountToMake: 12,
        machineAmounts: { "30th": 6, Towne: 6 },
      });
      const selected = validatedProductionPlanValues(values);
      expect(selected[blankRows + 2][1]).toBe("bObA PaCk");
      expect(parseProductionPlan(selected)).toEqual(plan);
    },
  );

  it("keeps Boba Pack while omitting summary rows and headings without shifting row numbers", () => {
    const values = [
      [...HEADERS, "Total Stickers"],
      ["Tea"],
      ["", "Thai Tea 16oz", 4, 4, "1", 0, "", 4],
      ["", "", 4, "", "", "", "", 4],
      ["Topping", "Boba Pack", 6, 6, "3", 0, ""],
      ["Tea", "Matcha 16oz", 4, 0, "", 4, "2", 4],
      ["Catering"],
      ["", "Unvalidated catering", "bad"],
    ];
    const selected = validatedProductionPlanValues(values);
    expect(selected).toHaveLength(6);
    expect(selected[1]).toEqual([]);
    expect(selected[3]).toEqual([]);
    expect(selected[4][1]).toBe("Boba Pack");
    expect(selected[5][0]).toBe("Tea");
    expect(parseProductionPlan(selected).map((item) => item.rowNumber)).toEqual(
      [3, 5, 6],
    );
  });

  it.each([
    [
      "blank quantities",
      ["Topping", "Boba Pack", "", "", "1", "", "2"],
      "INVALID_QUANTITY",
    ],
    [
      "excess capacity",
      ["Topping", "Boba Pack", 7, 7, "1", 0, ""],
      "SLOT_CAPACITY",
    ],
    [
      "invalid slot",
      ["Topping", "Boba Pack", 6, 6, "36", 0, ""],
      "INVALID_SLOTS",
    ],
    [
      "missing slot",
      ["Topping", "Boba Pack", 6, 6, "", 0, ""],
      "MISSING_SLOTS",
    ],
    [
      "overallocated",
      ["Topping", "Boba Pack", 6, 6, "1", 6, "2"],
      "OVERALLOCATED",
    ],
  ])("rejects Boba Pack with %s", (_, row, code) => {
    try {
      parseProductionPlan([HEADERS, row]);
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error.issues).toContainEqual(
        expect.objectContaining({ code, rowNumber: 2 }),
      );
    }
  });

  it("detects slot conflicts between Boba Pack and drinks", () => {
    expect(() =>
      parseProductionPlan([
        HEADERS,
        ["Tea", "Thai Tea 16oz", 4, 4, "1", 0, ""],
        ["Topping", "Boba Pack", 6, 6, "1", 0, ""],
      ]),
    ).toThrow("Duplicate 30th slot 1");
  });

  it("keeps normal drink capacity for boba toppings", () => {
    expect(() =>
      parseProductionPlan([
        HEADERS,
        ["Tea", "Thai Tea 16oz with Boba", 5, 5, "1", 0, ""],
      ]),
    ).toThrow("slot capacity");
  });

  it("accepts supported slot delimiters without dropping malformed tokens", () => {
    expect(parseSlots("1; 2,3 4")).toEqual([1, 2, 3, 4]);
    expect(parseSlots("1 nope 2")).toBeNull();
  });
});
