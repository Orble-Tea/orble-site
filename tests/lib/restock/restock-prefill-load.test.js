// GET prefill for a Load: Production Plan allocation and Nayax slot warnings.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPrefill } from "./prefill-setup.js";

describe("prefill: Load", () => {
  let buildRestockData;
  let getMachineConfig;

  beforeEach(async () => {
    ({ buildRestockData, getMachineConfig } = await loadPrefill());
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
              ["Drink Variation", "Amount to 30th", "Slot (30th)"],
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

    const data = await buildRestockData(getMachineConfig("30th"), "2026-07-10");

    expect(data.batchId).toBe("30th-2026-07-10");
    expect(data.event).toBe("Load");
    expect(data.slots).toHaveLength(35);
    expect(data.slots[0]).toMatchObject({
      slot: 1,
      previousDrink: "Taro Tea Less Sweet w/ Lychee 16oz",
      flavor: "Thai Tea",
      size: "16oz",
      topping: "Lychee",
      sweetness: "Less Sweet",
      previous: 2,
      waste: 2,
      expectedNew: 4,
      total: 4,
    });
    expect(data.slots[0]).not.toHaveProperty("drink");
    expect(data.slots[0]).not.toHaveProperty("empty");
    expect(data.slots[0]).not.toHaveProperty("unassigned");
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
              ["Drink Variation", "Amount to 30th", "Slot (30th)"],
              ["Thai Tea 16oz Regular Sweetness", 9, "1, 2, 3"],
            ],
          }),
        );
      }
      return new Response(JSON.stringify([]));
    });

    const data = await buildRestockData(getMachineConfig("30th"), "2026-07-10");

    expect(data.slots.slice(0, 3).map((slot) => slot.expectedNew)).toEqual([
      3, 3, 3,
    ]);
  });

  it("does not keep Nayax drink fields in Load slots absent from the Production Plan", async () => {
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
              ["Drink Variation", "Amount to 30th", "Slot (30th)"],
              ["Thai Tea 16oz Less Sweet w/ Lychee", 4, "8"],
            ],
          }),
        );
      }
      if (urlText.includes("machineProducts")) {
        return new Response(
          JSON.stringify([
            {
              MDBCode: 3,
              PAR: 4,
              MissingStockByMDB: 1,
              DEXProductName: "THAI_16_LESS_LYC",
            },
          ]),
        );
      }
      throw new Error(`Unexpected URL: ${urlText}`);
    });

    const data = await buildRestockData(getMachineConfig("30th"), "2026-07-10");

    expect(data.slots[2]).toMatchObject({
      slot: 3,
      previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee",
      flavor: null,
      size: null,
      topping: null,
      sweetness: null,
      previous: 3,
      waste: 3,
      expectedNew: 0,
      total: 0,
    });
    expect(data.slots[7]).toMatchObject({
      slot: 8,
      previousDrink: null,
      flavor: "Thai Tea",
      size: "16oz",
      topping: "Lychee",
      sweetness: "Less Sweet",
      previous: 0,
      waste: 0,
      expectedNew: 4,
      total: 4,
    });
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
              ["Drink Variation", "Amount to 30th", "Slot (30th)"],
              ["Strawberry Matcha 16oz", 8, "2; 22"],
            ],
          }),
        );
      }
      return new Response(JSON.stringify([]));
    });

    const data = await buildRestockData(getMachineConfig("30th"), "2026-07-10");

    expect(data.slots[1]).toMatchObject({
      slot: 2,
      flavor: "Matcha",
      topping: "Strawberry",
      size: "16oz",
      expectedNew: 4,
      total: 4,
    });
    expect(data.slots[21]).toMatchObject({
      slot: 22,
      flavor: "Matcha",
      topping: "Strawberry",
      size: "16oz",
      expectedNew: 4,
      total: 4,
    });
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
            values: [["Drink", "Storage", "To 30th"]],
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

    const data = await buildRestockData(getMachineConfig("30th"), "2026-07-10");

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
              ["Drink", "Storage", "To 30th"],
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
            DEXProductName: "THAI_16_LESS_LYC",
          },
        ]),
      );
    });

    const data = await buildRestockData(getMachineConfig("30th"), "2026-07-10");

    expect(data.slots[0]).toMatchObject({
      previous: 0,
      expectedNew: 2,
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
            values: [["Drink", "Storage", "To 30th"]],
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

    const data = await buildRestockData(getMachineConfig("30th"), "2026-07-10");

    expect(data.slots[25]).toMatchObject({
      slot: 26,
      previousDrink: null,
      flavor: null,
      topping: null,
      sweetness: null,
      previous: 0,
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

  it.each([
    ["Mango Passion Fruit Tea 24oz", 'unrecognized "24oz", missing or invalid size'],
    ["Matcha 16oz Less Sugar", 'unrecognized "Less Sugar"'],
    ["Matcha with Strawberry", "missing or invalid size"],
  ])(
    "refuses a Load when Production Plan row %j has an amount but is not a known drink: %s",
    async (row, reason) => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
        const urlText = String(url);
        if (urlText.includes("Restock%20Log"))
          return new Response(
            JSON.stringify({ values: [["Batch ID", "Event"]] }),
          );
        if (urlText.includes("Production%20Plan"))
          return new Response(
            JSON.stringify({
              values: [
                ["Drink Variation", "Amount to 30th", "Slot (30th)"],
                [row, 3, "1"],
                ["Thai Tea 16oz Less Sweet", 3, "2"],
                ["BMT22", 0, "3"],
              ],
            }),
          );
        return new Response(JSON.stringify([]));
      });

      await expect(
        buildRestockData(getMachineConfig("30th"), "2026-07-10"),
      ).rejects.toMatchObject({
        status: 409,
        message: `Production Plan has drinks that cannot be read for 30th: ${row} (${reason}). Fix their names, then start again.`,
      });
    },
  );
});
