import { describe, expect, it } from "vitest";
import { buildLabelPrintData } from "../../../src/lib/label-printer/production-plan.js";

describe("buildLabelPrintData", () => {
  it("preserves both machines' full slot lists, storage, and one backup", () => {
    const { rows } = buildLabelPrintData(
      [
        {
          "Drink Variation": "Mango Passion Fruit Tea 16oz",
          "Amount to Make": "5",
          "Amount to 30TH": "1",
          "Slot (30TH)": "1, 2",
          "Amount to Towne": "2",
          "Slot (Towne)": "4 5",
        },
      ],
      { now: new Date("2026-09-21T12:00:00Z") },
    );
    expect(rows[0]).toMatchObject({
      directLabels: 3,
      storageLabels: 2,
      spareLabels: 1,
    });
    expect(rows[0].labels.map((label) => label.code)).toEqual([
      "30TH#1,2",
      "TWNE#4,5",
      "TWNE#4,5",
      "",
      "",
      "",
    ]);
    expect(
      rows[0].labels.every((label) => label.expirationDate === "09/28/26"),
    ).toBe(true);
  });

  it("needs no recipe column and keeps separate drink rows in sheet order", () => {
    const data = buildLabelPrintData([
      {
        "drink variation": "Matcha 16oz",
        "amount to make": "1",
        "amount to 30th": "1",
        "slot (30th)": "7",
      },
      { "drink variation": "Matcha 24oz", "amount to make": "2" },
      { "drink variation": "Not made", "amount to make": "0" },
      { "amount to make": "2" },
    ]);
    expect(data.rows.map((row) => row.drinkName)).toEqual([
      "Matcha 16oz",
      "Matcha 24oz",
    ]);
    expect(data.rows.map((row) => row.labels.length)).toEqual([2, 3]);
    expect(data.rows[0].labels[0].code).toBe("30TH#7");
    expect(data).not.toHaveProperty("recipes");
    expect(data.rows[0]).not.toHaveProperty("totalLabels");
  });

  it.each([
    ["2026-09-28T03:00:00Z", "10/05/26"],
    ["2026-12-28T23:30:00Z", "01/04/27"],
    ["2028-02-23T15:00:00Z", "03/01/28"],
    ["2026-09-27T23:30:00-04:00", "10/05/26"],
  ])(
    "adds seven UTC days to %s without mutating the clock",
    (instant, expiration) => {
      const now = new Date(instant);
      const time = now.getTime();
      const { rows } = buildLabelPrintData(
        [{ "Drink Variation": "Thai Tea 16oz", "Amount to Make": "1" }],
        { now },
      );
      expect(rows[0].labels[0].expirationDate).toBe(expiration);
      expect(now.getTime()).toBe(time);
    },
  );
});
