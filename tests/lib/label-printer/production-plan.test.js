import { describe, expect, it } from "vitest";
import { buildLabelPrintData } from "../../../src/lib/label-printer/production-plan.js";

describe("buildLabelPrintData", () => {
  it("builds machine and storage labels from production plan machine columns", () => {
    const data = buildLabelPrintData(
      [
        {
          Recipe: "Mango Passion Fruit Tea",
          "Drink Variation": "Mango Passion Fruit Tea 16oz",
          "Amount to Make": "5",
          "Amount to 30TH": "1",
          "Slot (30TH)": "21",
          "Amount to Towne": "2",
          "Slot (Towne)": "4 5",
          Date: "09/21/26",
        },
      ],
      { now: new Date("2026-09-21T12:00:00-04:00") },
    );

    expect(data).toMatchObject({
      recipeCount: 1,
      totalLabels: 5,
      recipes: [
        {
          recipe: "Mango Passion Fruit Tea",
          totalLabels: 5,
          rows: [
            {
              drinkName: "Mango Passion Fruit Tea 16oz",
              expirationDate: "09/28/26",
              totalLabels: 5,
              directLabels: 3,
              storageLabels: 2,
            },
          ],
        },
      ],
    });
    expect(data.recipes[0].labels.map((label) => label.code)).toEqual([
      "30TH#21",
      "TWNE#4",
      "TWNE#5",
      "",
      "",
    ]);
  });

  it("uses filled-down recipe names and case-insensitive header lookup", () => {
    const data = buildLabelPrintData(
      [
        {
          recipe: "Strawberry Matcha",
          "drink variation": "Strawberry Matcha 16oz",
          "amount to make": "1",
          "amount to 30th": "1",
          "slot (30th)": "7",
        },
        {
          recipe: "",
          "drink variation": "Strawberry Matcha 24oz",
          "amount to make": "2",
          "amount to 30th": "0",
          "slot (30th)": "",
        },
      ],
      { now: new Date("2026-09-21T12:00:00-04:00") },
    );

    expect(data.recipeCount).toBe(1);
    expect(data.totalLabels).toBe(3);
    expect(data.recipes[0].rows.map((row) => row.recipe)).toEqual([
      "Strawberry Matcha",
      "Strawberry Matcha",
    ]);
    expect(data.recipes[0].labels.map((label) => label.code)).toEqual([
      "30TH#7",
      "",
      "",
    ]);
  });

  it("falls back to the current New York date when no date column is provided", () => {
    const data = buildLabelPrintData(
      [
        {
          Recipe: "Thai Tea",
          "Drink Variation": "Thai Tea 16oz",
          "Amount to Make": "1",
        },
      ],
      { now: new Date("2026-09-28T03:00:00Z") },
    );

    expect(data.recipes[0].labels[0].expirationDate).toBe("10/04/26");
  });
});
