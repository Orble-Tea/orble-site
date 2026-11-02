import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERRORS } from "../../../src/lib/restock/errors.js";

describe("GET /api/restock", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("rejects requests with an invalid secret key", async () => {
    const { GET } = await import("../../../src/pages/api/restock.js");
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");

    const response = await GET({
      url: new URL(
        "https://orble.test/api/restock?key=bad&machine=30th&date=2026-07-10",
      ),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Invalid RESTOCK_SECRET_KEY",
    });
  });

  it("rejects unknown machines", async () => {
    const { GET } = await import("../../../src/pages/api/restock.js");
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");

    const response = await GET({
      url: new URL(
        "https://orble.test/api/restock?key=secret&machine=campus&date=2026-07-10",
      ),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unknown machine" });
  });

  it("rejects invalid dates before calling external services", async () => {
    const { GET } = await import("../../../src/pages/api/restock.js");
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");
    vi.stubEnv("NAYAX_MACHINE_30TH_ID", "123");

    const response = await GET({
      url: new URL(
        "https://orble.test/api/restock?key=secret&machine=30th&date=07-10-2026",
      ),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid date" });
  });

  it("returns a server error when a known machine is missing deployment config", async () => {
    const { GET } = await import("../../../src/pages/api/restock.js");
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");

    const response = await GET({
      url: new URL(
        "https://orble.test/api/restock?key=secret&machine=30th&date=2026-07-10",
      ),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Machine is not configured",
    });
  });

  it("recognizes Towne as a known machine", async () => {
    const { GET } = await import("../../../src/pages/api/restock.js");
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");

    const response = await GET({
      url: new URL(
        "https://orble.test/api/restock?key=secret&machine=towne&date=2026-07-10",
      ),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Machine is not configured",
    });
  });

  it("returns restock data for a valid request", async () => {
    vi.resetModules();
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");
    vi.stubEnv("NAYAX_MACHINE_30TH_ID", "machine-1");
    vi.stubEnv("PRODUCTION_PLAN_SHEET_ID", "production-plan-sheet");
    vi.stubEnv("INVENTORY_SHEET_ID", "inventory-sheet");
    vi.stubEnv("RESTOCK_LOG_SHEET_ID", "restock-log-sheet");
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "sheets-token");
    vi.stubEnv("NAYAX_API_TOKEN", "nayax-token");
    const { GET } = await import("../../../src/pages/api/restock.js");

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
      return new Response(
        JSON.stringify([
          {
            MDBCode: 1,
            PAR: 4,
            MissingStockByMDB: 2,
            DEXProductName: "Thai Tea Less Sweet w/ Lychee 16oz",
          },
        ]),
      );
    });

    const response = await GET({
      url: new URL(
        "https://orble.test/api/restock?key=secret&machine=30th&date=2026-07-10",
      ),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      batchId: "30th-2026-07-10",
      event: "Load",
      slots: expect.arrayContaining([
        expect.objectContaining({
          slotNumber: 1,
          previousDrink: "Thai Tea Less Sweet w/ Lychee 16oz",
          flavor: "Thai Tea",
          topping: "Lychee",
          sweetness: "Less Sweet",
        }),
      ]),
    });
    expect(body.slots[0]).not.toHaveProperty("drink");
  });

  it("returns a Split after the Load, until the kitchen logs one", async () => {
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");
    vi.stubEnv("NAYAX_MACHINE_30TH_ID", "machine-1");
    vi.stubEnv("NAYAX_MACHINE_TOWNE_ID", "machine-2");
    vi.stubEnv("PRODUCTION_PLAN_SHEET_ID", "production-plan-sheet");
    vi.stubEnv("INVENTORY_SHEET_ID", "inventory-sheet");
    vi.stubEnv("RESTOCK_LOG_SHEET_ID", "restock-log-sheet");
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "sheets-token");
    vi.stubEnv("NAYAX_API_TOKEN", "nayax-token");
    const { GET } = await import("../../../src/pages/api/restock.js");

    const product = (slot, missing, name) => ({
      MDBCode: slot,
      PAR: 4,
      MissingStockByMDB: missing,
      DEXProductName: name,
    });
    const thai = (slot, missing) => product(slot, missing, "THAI_16_LESS_LYC");
    // Every slot from `from` to 35 full of Taro, so the machine has no empty slot
    const fullOfTaro = (from) =>
      Array.from({ length: 36 - from }, (_, i) =>
        product(from + i, 0, "TARO_22_LESS"),
      );
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
              ["Drink", "Storage"],
              ["Thai Tea 16oz Less Sweet w/ Lychee", 9],
              ["Taro Tea 22oz Less Sweet", 1],
              ["Matcha 16oz Less Sweet", 3],
            ],
          }),
        );
      }
      // 30th: Thai at 2, the rest full. Towne: Thai at 1, slot 2 holds a
      // product nobody can read, the rest full. The only place Thai's
      // leftover can go is Towne slot 2, which the Split plans as empty.
      if (urlText.includes("/machines/machine-1/"))
        return new Response(JSON.stringify([thai(1, 2), ...fullOfTaro(2)]));
      return new Response(
        JSON.stringify([thai(1, 3), product(2, 3, "BMT22"), ...fullOfTaro(3)]),
      );
    });

    const response = await GET({
      url: new URL(
        "https://orble.test/api/restock?key=secret&machine=30th&date=2026-07-10",
      ),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      batchId: "Kitchen-2026-07-10",
      event: "Split",
      drinks: [
        {
          drink: "Thai Tea 16oz Less Sweet w/ Lychee",
          storage: 9,
          to30th: 2,
          toTowne: 7,
        },
        {
          drink: "Taro Tea 22oz Less Sweet",
          storage: 1,
          to30th: 0,
          toTowne: 0,
        },
        { drink: "Matcha 16oz Less Sweet", storage: 3, to30th: 0, toTowne: 0 },
      ],
      warnings: [
        expect.objectContaining({
          slot: 2,
          code: "UNPARSED_NAYAX_PRODUCT_NAME",
        }),
      ],
    });
  });

  it("returns clearout when requested explicitly", async () => {
    vi.resetModules();
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");
    vi.stubEnv("NAYAX_MACHINE_30TH_ID", "machine-1");
    vi.stubEnv("INVENTORY_SHEET_ID", "inventory-sheet");
    vi.stubEnv("RESTOCK_LOG_SHEET_ID", "restock-log-sheet");
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "sheets-token");
    vi.stubEnv("NAYAX_API_TOKEN", "nayax-token");
    const { GET } = await import("../../../src/pages/api/restock.js");

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

    const response = await GET({
      url: new URL(
        "https://orble.test/api/restock?key=secret&machine=30th&date=2026-07-10&mode=clearout",
      ),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      batchId: "30th-2026-07-10",
      event: "Clearout",
    });
  });

  it("rejects Clearout when the batch has no Load", async () => {
    vi.resetModules();
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");
    vi.stubEnv("NAYAX_MACHINE_30TH_ID", "machine-1");
    vi.stubEnv("RESTOCK_LOG_SHEET_ID", "restock-log-sheet");
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "sheets-token");
    vi.stubEnv("NAYAX_API_TOKEN", "nayax-token");
    const { GET } = await import("../../../src/pages/api/restock.js");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ values: [["Batch ID", "Event"]] })),
    );

    const response = await GET({
      url: new URL(
        "https://orble.test/api/restock?key=secret&machine=30th&date=2026-07-10&mode=clearout",
      ),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: ERRORS.needsEventFirst("Load", "Clearout").message,
    });
  });

  it("returns a conflict for a batch that was already cleared out", async () => {
    vi.resetModules();
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");
    vi.stubEnv("NAYAX_MACHINE_30TH_ID", "machine-1");
    vi.stubEnv("RESTOCK_LOG_SHEET_ID", "restock-log-sheet");
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "sheets-token");
    vi.stubEnv("NAYAX_API_TOKEN", "nayax-token");
    const { GET } = await import("../../../src/pages/api/restock.js");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          values: [
            ["Batch ID", "Event"],
            ["30th-2026-07-10", "Load"],
            ["30th-2026-07-10", "Clearout"],
          ],
        }),
      ),
    );

    const response = await GET({
      url: new URL(
        "https://orble.test/api/restock?key=secret&machine=30th&date=2026-07-10",
      ),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: ERRORS.batchClearedOut.message,
    });
  });

  it("returns a conflict after load and topoff are already logged", async () => {
    vi.resetModules();
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");
    vi.stubEnv("NAYAX_MACHINE_30TH_ID", "machine-1");
    vi.stubEnv("PRODUCTION_PLAN_SHEET_ID", "production-plan-sheet");
    vi.stubEnv("INVENTORY_SHEET_ID", "inventory-sheet");
    vi.stubEnv("RESTOCK_LOG_SHEET_ID", "restock-log-sheet");
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "sheets-token");
    const { GET } = await import("../../../src/pages/api/restock.js");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          values: [
            ["Batch ID", "Event"],
            ["30th-2026-07-10", "Load"],
            ["30th-2026-07-10", "Topoff"],
          ],
        }),
      ),
    );

    const response = await GET({
      url: new URL(
        "https://orble.test/api/restock?key=secret&machine=30th&date=2026-07-10",
      ),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: ERRORS.batchFullyLogged.message,
      details: { existingEntryRow: 3 },
    });
  });

  it("returns safe upstream Nayax auth errors", async () => {
    vi.resetModules();
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");
    vi.stubEnv("NAYAX_MACHINE_30TH_ID", "machine-1");
    vi.stubEnv("PRODUCTION_PLAN_SHEET_ID", "production-plan-sheet");
    vi.stubEnv("INVENTORY_SHEET_ID", "inventory-sheet");
    vi.stubEnv("RESTOCK_LOG_SHEET_ID", "restock-log-sheet");
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "sheets-token");
    vi.stubEnv("NAYAX_API_TOKEN", "nayax-token");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("../../../src/pages/api/restock.js");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("machineProducts"))
        return new Response("Forbidden", { status: 403 });
      if (String(url).includes("Restock%20Log")) {
        return new Response(
          JSON.stringify({ values: [["Batch ID", "Event"]] }),
        );
      }
      return new Response(JSON.stringify({ values: [] }));
    });

    const response = await GET({
      url: new URL(
        "https://orble.test/api/restock?key=secret&machine=30th&date=2026-07-10",
      ),
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "NAYAX_API_TOKEN is not authorized",
      details: {
        service: "nayax",
        operation: "get_machine_products",
        status: 403,
      },
    });
  });
});
