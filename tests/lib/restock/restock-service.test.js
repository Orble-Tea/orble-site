import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("restock service", () => {
  let buildRestockData;
  let getMachineConfig;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "sheets-token");
    vi.stubEnv("NAYAX_API_TOKEN", "nayax-token");
    vi.stubEnv("NAYAX_MACHINE_30TH_ID", "machine-1");
    vi.stubEnv("PRODUCTION_PLAN_SHEET_ID", "production-plan-sheet");
    vi.stubEnv("INVENTORY_SHEET_ID", "inventory-sheet");
    vi.stubEnv("RESTOCK_LOG_SHEET_ID", "restock-log-sheet");

    ({ getMachineConfig } = await import("../../../src/lib/restock/config.js"));
    ({ buildRestockData } = await import(
      "../../../src/lib/restock/restock-service.js"
    ));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("builds Load restock data from Nayax and the Production Plan", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlText = String(url);
      if (urlText.includes("Restock%20Log")) {
        return new Response(
          JSON.stringify({ values: [["Batch ID", "Event"]] }),
        );
      }
      if (urlText.includes("Production%20Plan")) {
        return new Response(
          JSON.stringify({
            values: [
              ["Drink Variation", "Amount to 30TH", "Slot (30TH)"],
              ["Thai Tea Less Sweet w/ Lychee 16oz", 4, "1"],
            ],
          }),
        );
      }
      if (urlText.includes("machineProducts")) {
        return new Response(
          JSON.stringify([
            {
              MDBCode: 1,
              PAR: 4,
              MissingStockByMDB: 2,
              DEXProductName: "Taro Tea Less Sweet w/ Lychee 16oz",
            },
          ]),
        );
      }
      throw new Error(`Unexpected URL: ${urlText}`);
    });

    const data = await buildRestockData(
      getMachineConfig("30th"),
      "2026-07-10",
    );

    expect(data.batchId).toBe("30TH-2026-07-10");
    expect(data.event).toBe("Load");
    expect(data.slots).toHaveLength(35);
    expect(data.slots[0]).toMatchObject({
      slot: 1,
      drink: "Thai Tea Less Sweet w/ Lychee 16oz",
      previousDrink: "Taro Tea Less Sweet w/ Lychee 16oz",
      flavor: "Thai Tea",
      size: "16oz",
      topping: "Lychee",
      sweetnessLevel: "Less Sweet",
      previous: 2,
      waste: 2,
      expectedNew: 4,
      new: 4,
      total: 4,
      empty: false,
    });
  });

  it("distributes Load quantities evenly across multiple slots", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlText = String(url);
      if (urlText.includes("Restock%20Log")) {
        return new Response(
          JSON.stringify({ values: [["Batch ID", "Event"]] }),
        );
      }
      if (urlText.includes("Production%20Plan")) {
        return new Response(
          JSON.stringify({
            values: [
              ["Drink Variation", "Amount to 30TH", "Slot (30TH)"],
              ["Thai Tea Normal 16oz", 9, "1, 2, 3"],
            ],
          }),
        );
      }
      return new Response(JSON.stringify([]));
    });

    const data = await buildRestockData(
      getMachineConfig("30th"),
      "2026-07-10",
    );

    expect(data.slots.slice(0, 3).map((slot) => slot.new)).toEqual([3, 3, 3]);
  });

  it("distributes Load quantities across semicolon-separated slots from the Production Plan", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlText = String(url);
      if (urlText.includes("Restock%20Log")) {
        return new Response(
          JSON.stringify({ values: [["Batch ID", "Event"]] }),
        );
      }
      if (urlText.includes("Production%20Plan")) {
        return new Response(
          JSON.stringify({
            values: [
              ["Drink Variation", "Amount to 30TH", "Slot (30TH)"],
              ["Strawberry Matcha 16oz", 8, "2; 22"],
            ],
          }),
        );
      }
      return new Response(JSON.stringify([]));
    });

    const data = await buildRestockData(
      getMachineConfig("30th"),
      "2026-07-10",
    );

    expect(data.slots[1]).toMatchObject({
      slot: 2,
      drink: "Strawberry Matcha 16oz",
      expectedNew: 4,
      new: 4,
      total: 4,
      empty: false,
    });
    expect(data.slots[21]).toMatchObject({
      slot: 22,
      drink: "Strawberry Matcha 16oz",
      expectedNew: 4,
      new: 4,
      total: 4,
      empty: false,
    });
  });

  it("prefills Topoff quantities from Inventory storage", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlText = String(url);
      if (urlText.includes("Restock%20Log")) {
        return new Response(
          JSON.stringify({
            values: [
              ["Batch ID", "Event"],
              ["30TH-2026-07-10", "Load"],
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
              ["Drink", "Storage"],
              ["Thai Tea 16oz Less Sugar w/ Lychee", 2],
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

    const data = await buildRestockData(
      getMachineConfig("30th"),
      "2026-07-10",
    );

    expect(data.event).toBe("Topoff");
    expect(data.slots[0]).toMatchObject({
      drink: "Thai Tea Less Sugar w/ Lychee 16oz",
      previousDrink: "Thai Tea Less Sugar w/ Lychee 16oz",
      flavor: "Thai Tea",
      size: "16oz",
      topping: "Lychee",
      sweetnessLevel: "Less Sugar",
      previous: 2,
      waste: 0,
      expectedNew: 2,
      new: 2,
      total: 4,
      empty: false,
    });
    expect(data.slots[0].new).toBe(2);
  });

  it("warns when Nayax returns an occupied slot without a parseable drink name", async () => {
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlText = String(url);
      if (urlText.includes("Restock%20Log")) {
        return new Response(
          JSON.stringify({
            values: [
              ["Batch ID", "Event"],
              ["30TH-2026-07-10", "Load"],
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
            values: [["Drink", "Storage"]],
          }),
        );
      }
      return new Response(
        JSON.stringify([
          {
            MDBCode: 1,
            PAR: 4,
            MissingStockByMDB: 0,
            DEXProductName: "UNKNOWN_CODE",
          },
        ]),
      );
    });

    const data = await buildRestockData(
      getMachineConfig("30th"),
      "2026-07-10",
    );

    expect(data.warnings).toEqual([
      expect.objectContaining({
        code: "UNPARSED_NAYAX_PRODUCT_NAME",
        slot: 1,
        productName: "UNKNOWN_CODE",
      }),
    ]);
    expect(warnMock).toHaveBeenCalledWith(
      "restock-data warning:",
      expect.objectContaining({ code: "UNPARSED_NAYAX_PRODUCT_NAME" }),
    );
  });

  it("warns when Nayax returns PAR without an on-hand count", async () => {
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlText = String(url);
      if (urlText.includes("Restock%20Log")) {
        return new Response(
          JSON.stringify({
            values: [
              ["Batch ID", "Event"],
              ["30TH-2026-07-10", "Load"],
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
              ["Drink", "Storage"],
              ["Thai Tea 16oz Less Sugar w/ Lychee", 2],
            ],
          }),
        );
      }
      return new Response(
        JSON.stringify([
          {
            MDBCode: 1,
            PAR: 4,
            DEXProductName: "THAI_16_LESS_LYC",
          },
        ]),
      );
    });

    const data = await buildRestockData(
      getMachineConfig("30th"),
      "2026-07-10",
    );

    expect(data.slots[0]).toMatchObject({
      previous: 0,
      expectedNew: 2,
      new: 2,
      total: 2,
    });
    expect(data.warnings).toEqual([
      expect.objectContaining({
        code: "MISSING_NAYAX_ON_HAND",
        slot: 1,
        par: 4,
      }),
    ]);
    expect(warnMock).toHaveBeenCalledWith(
      "restock-data warning:",
      expect.objectContaining({ code: "MISSING_NAYAX_ON_HAND" }),
    );
  });

  it("warns when Nayax returns a configured slot without a product name", async () => {
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlText = String(url);
      if (urlText.includes("Restock%20Log")) {
        return new Response(
          JSON.stringify({
            values: [
              ["Batch ID", "Event"],
              ["30TH-2026-07-10", "Load"],
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
            values: [["Drink", "Storage"]],
          }),
        );
      }
      return new Response(
        JSON.stringify([
          {
            MDBCode: 26,
            PAR: 4,
            MissingStockByMDB: 4,
            DEXProductName: "",
          },
        ]),
      );
    });

    const data = await buildRestockData(
      getMachineConfig("30th"),
      "2026-07-10",
    );

    expect(data.slots[25]).toMatchObject({
      slot: 26,
      drink: "",
      previousDrink: "",
      previous: 0,
      empty: false,
    });
    expect(data.warnings).toEqual([
      expect.objectContaining({
        code: "MISSING_NAYAX_PRODUCT_NAME",
        slot: 26,
        previous: 0,
        par: 4,
      }),
    ]);
    expect(warnMock).toHaveBeenCalledWith(
      "restock-data warning:",
      expect.objectContaining({ code: "MISSING_NAYAX_PRODUCT_NAME" }),
    );
  });

  it("returns Clearout when explicitly requested for a clearout-only day", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlText = String(url);
      if (urlText.includes("Restock%20Log")) {
        return new Response(
          JSON.stringify({ values: [["Batch ID", "Event"]] }),
        );
      }
      return new Response(
        JSON.stringify([
          {
            MDBCode: 1,
            PAR: 4,
            MissingStockByMDB: 3,
            DEXProductName: "Thai Tea Less Sweet w/ Lychee 16oz",
          },
        ]),
      );
    });

    const data = await buildRestockData(
      getMachineConfig("30th"),
      "2026-07-10",
      {
        mode: "clearout",
      },
    );

    expect(data.event).toBe("Clearout");
    expect(data.slots[0]).toMatchObject({
      drink: "Thai Tea Less Sweet w/ Lychee 16oz",
      previousDrink: "Thai Tea Less Sweet w/ Lychee 16oz",
      previous: 1,
      waste: 1,
      expectedNew: 0,
      new: 0,
      total: 0,
    });
  });

  it("throws an already submitted error after Load and Topoff exist", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          values: [
            ["Batch ID", "Event"],
            ["30TH-2026-07-10", "Load"],
            ["30TH-2026-07-10", "Topoff"],
          ],
        }),
      ),
    );

    await expect(
      buildRestockData(getMachineConfig("30th"), "2026-07-10"),
    ).rejects.toMatchObject({
      alreadySubmitted: true,
      existingEntryRow: 2,
    });
  });

});
