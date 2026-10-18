// GET prefill for a Topoff: Inventory allocation across the machine's slots.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
              { properties: { title: "Inventory-2026-08-18", index: 1 } },
            ],
          }),
        );
      }
      if (urlText.includes("Inventory-2026-08-18")) {
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
            sheets: [
              { properties: { title: "Inventory-2026-08-18", index: 0 } },
            ],
          }),
        );
      }
      if (urlText.includes("Inventory-2026-08-18")) {
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
            sheets: [
              { properties: { title: "Inventory-2026-08-18", index: 0 } },
            ],
          }),
        );
      }
      if (urlText.includes("Inventory-2026-08-18")) {
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
      slot: 1,
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
            sheets: [
              { properties: { title: "Inventory-2026-08-18", index: 0 } },
            ],
          }),
        );
      }
      if (urlText.includes("Inventory-2026-08-18")) {
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
      slot: 1,
      previous: 3,
      expectedNew: 0,
      total: 3,
    });
    expect(data.slots[1]).toMatchObject({
      slot: 2,
      previous: 0,
      expectedNew: 3,
      total: 3,
    });
  });
});
