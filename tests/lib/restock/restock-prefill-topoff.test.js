// GET prefill for a Topoff: Inventory allocation across the machine's slots.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERRORS } from "../../../src/lib/restock/errors.js";
import { loadPrefill } from "./prefill-setup.js";

describe("prefill: Topoff", () => {
  let buildRestockData;
  let getMachineConfig;

  beforeEach(async () => {
    ({ buildRestockData, getMachineConfig } = await loadPrefill());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("prefills Topoff quantities from the Inventory column for the requested machine", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlText = String(url);
      if (urlText.includes("Restock%20Log")) {
        return new Response(
          JSON.stringify({
            values: [
              ["Batch ID", "Event"],
              ["30th-2026-07-10", "Load"],
            ],
          }),
        );
      }
      if (urlText.endsWith("/inventory-sheet")) {
        return new Response(
          JSON.stringify({
            sheets: [
              { properties: { title: "Inventory-2026-08-17", index: 0 } },
              { properties: { title: "07/10/2026", index: 1 } },
            ],
          }),
        );
      }
      if (urlText.includes("07%2F10%2F2026")) {
        return new Response(
          JSON.stringify({
            values: [
              ["Drink", "Storage", "To 30th", "To Towne"],
              ["Thai Tea 16oz Less Sweet w/ Lychee", 8, 2, 6],
            ],
          }),
        );
      }
      return new Response(
        JSON.stringify([
          {
            MDBCode: 1,
            PAR: 4,
            MissingStockByMDB: 2,
            DEXProductName: "THAI_16_LESS_LYC",
          },
        ]),
      );
    });

    const data = await buildRestockData(getMachineConfig("30th"), "2026-07-10");

    expect(data.event).toBe("Topoff");
    expect(data.slots[0]).toMatchObject({
      previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee",
      flavor: "Thai Tea",
      size: "16oz",
      topping: "Lychee",
      sweetness: "Less Sweet",
      previous: 2,
      waste: 0,
      expectedNew: 2,
      total: 4,
    });
    expect(data.slots[0]).not.toHaveProperty("drink");
    expect(data.slots[0].expectedNew).toBe(2);
  });

  it("matches Inventory allocation columns regardless of capitalization or spacing", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlText = String(url);
      if (urlText.includes("Restock%20Log")) {
        return new Response(
          JSON.stringify({
            values: [
              ["Batch ID", "Event"],
              ["30th-2026-07-10", "load"],
            ],
          }),
        );
      }
      if (urlText.endsWith("/inventory-sheet")) {
        return new Response(
          JSON.stringify({
            sheets: [{ properties: { title: "07/10/2026", index: 0 } }],
          }),
        );
      }
      if (urlText.includes("07%2F10%2F2026")) {
        return new Response(
          JSON.stringify({
            values: [
              ["DRINK", "storage", "To-30 th"],
              ["Thai Tea 16oz Less Sweet w/ Lychee", 2, 2],
            ],
          }),
        );
      }
      return new Response(
        JSON.stringify([
          {
            MDBCode: 1,
            PAR: 4,
            MissingStockByMDB: 4,
            DEXProductName: "THAI_16_LESS_LYC",
          },
        ]),
      );
    });

    const data = await buildRestockData(getMachineConfig("30th"), "2026-07-10");

    expect(data.event).toBe("Topoff");
    expect(data.slots[0]).toMatchObject({
      previous: 0,
      expectedNew: 2,
      total: 2,
    });
    expect(data.warnings).toEqual([]);
  });

  it("does not use Inventory amounts assigned to a different machine for Topoff", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlText = String(url);
      if (urlText.includes("Restock%20Log")) {
        return new Response(
          JSON.stringify({
            values: [
              ["Batch ID", "Event"],
              ["30th-2026-07-10", "Load"],
            ],
          }),
        );
      }
      if (urlText.endsWith("/inventory-sheet")) {
        return new Response(
          JSON.stringify({
            sheets: [{ properties: { title: "07/10/2026", index: 0 } }],
          }),
        );
      }
      if (urlText.includes("07%2F10%2F2026")) {
        return new Response(
          JSON.stringify({
            values: [
              ["Drink", "Storage", "To 30th", "To Towne"],
              ["Thai Tea 16oz Less Sweet w/ Lychee", 3, 0, 3],
            ],
          }),
        );
      }
      return new Response(
        JSON.stringify([
          {
            MDBCode: 1,
            PAR: 4,
            MissingStockByMDB: 4,
            DEXProductName: "THAI_16_LESS_LYC",
          },
        ]),
      );
    });

    const data = await buildRestockData(getMachineConfig("30th"), "2026-07-10");

    expect(data.event).toBe("Topoff");
    expect(data.slots[0]).toMatchObject({
      slotNumber: 1,
      previous: 0,
      expectedNew: 0,
      total: 0,
    });
  });

  it("allocates the requested machine Topoff amount to its emptiest matching slots", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlText = String(url);
      if (urlText.includes("Restock%20Log")) {
        return new Response(
          JSON.stringify({
            values: [
              ["Batch ID", "Event"],
              ["30th-2026-07-10", "Load"],
            ],
          }),
        );
      }
      if (urlText.endsWith("/inventory-sheet")) {
        return new Response(
          JSON.stringify({
            sheets: [{ properties: { title: "07/10/2026", index: 0 } }],
          }),
        );
      }
      if (urlText.includes("07%2F10%2F2026")) {
        return new Response(
          JSON.stringify({
            values: [
              ["Drink", "Storage", "To 30th", "To Towne"],
              ["Thai Tea 16oz Less Sweet w/ Lychee", 6, 3, 3],
            ],
          }),
        );
      }
      return new Response(
        JSON.stringify([
          {
            MDBCode: 1,
            PAR: 4,
            MissingStockByMDB: 1,
            DEXProductName: "THAI_16_LESS_LYC",
          },
          {
            MDBCode: 2,
            PAR: 4,
            MissingStockByMDB: 4,
            DEXProductName: "THAI_16_LESS_LYC",
          },
        ]),
      );
    });

    const data = await buildRestockData(getMachineConfig("30th"), "2026-07-10");

    expect(data.event).toBe("Topoff");
    expect(data.slots[0]).toMatchObject({
      slotNumber: 1,
      previous: 3,
      expectedNew: 0,
      total: 3,
    });
    expect(data.slots[1]).toMatchObject({
      slotNumber: 2,
      previous: 0,
      expectedNew: 3,
      total: 3,
    });
  });

  it("refuses a Topoff when the Inventory workbook has no tab for the batch date", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlText = String(url);
      if (urlText.includes("Restock%20Log"))
        return new Response(
          JSON.stringify({
            values: [
              ["Batch ID", "Event"],
              ["30th-2026-07-10", "Load"],
            ],
          }),
        );
      if (urlText.endsWith("/inventory-sheet"))
        return new Response(
          JSON.stringify({
            sheets: [{ properties: { title: "07/08/2026", index: 0 } }],
          }),
        );
      return new Response(JSON.stringify([]));
    });

    await expect(
      buildRestockData(getMachineConfig("30th"), "2026-07-10"),
    ).rejects.toMatchObject({
      status: 409,
      message: ERRORS.noInventoryForBatch("2026-07-10").message,
    });
  });

  it.each([
    ["Matcha 16oz Less Sugar", 'unrecognized "Less Sugar"'],
    ["Taro Tea 22oz LessSweet", 'unrecognized "LessSweet"'],
    ["Thai Tea 24oz Less Sweet", 'unrecognized "24oz", missing or invalid size'],
    ["Matcha with Strawberry", "missing or invalid size"],
    ["BMT22", 'unrecognized "BMT22", missing flavor, missing or invalid size'],
  ])(
    "refuses a Topoff when Inventory row %j has an amount but is not a known drink: %s",
    async (row, reason) => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
        const urlText = String(url);
        if (urlText.includes("Restock%20Log"))
          return new Response(
            JSON.stringify({
              values: [
                ["Batch ID", "Event"],
                ["30th-2026-07-10", "Load"],
              ],
            }),
          );
        if (urlText.endsWith("/inventory-sheet"))
          return new Response(
            JSON.stringify({
              sheets: [{ properties: { title: "07/10/2026", index: 0 } }],
            }),
          );
        if (urlText.includes("07%2F10%2F2026"))
          return new Response(
            JSON.stringify({
              values: [
                ["Drink", "Storage", "To 30th", "To Towne"],
                [row, 0, 2, 0],
                ["Thai Tea 16oz Less Sweet", 0, 3, 0],
                ["Viet Latte 12oz", 0, 0, 4],
              ],
            }),
          );
        return new Response(
          JSON.stringify([
            {
              MDBCode: 1,
              PAR: 4,
              MissingStockByMDB: 2,
              DEXProductName: "MATC_16_LESS",
            },
            {
              MDBCode: 2,
              PAR: 4,
              MissingStockByMDB: 1,
              DEXProductName: "TARO_22_LESS",
            },
            {
              MDBCode: 3,
              PAR: 4,
              MissingStockByMDB: 3,
              DEXProductName: "THAI_16_LESS",
            },
          ]),
        );
      });

      await expect(
        buildRestockData(getMachineConfig("30th"), "2026-07-10"),
      ).rejects.toMatchObject({
        status: 409,
        message: `Inventory tab 07/10/2026 has drinks that cannot be read for 30th: ${row} (${reason}). Fix their names, then start again.`,
      });
    },
  );
});
