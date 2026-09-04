import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("GET /api/restock-data", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("rejects requests with an invalid secret key", async () => {
    const { GET } = await import("../../../src/pages/api/restock-data.js");
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");

    const response = await GET({
      url: new URL(
        "https://orble.test/api/restock-data?key=bad&machine=30th&date=2026-07-10",
      ),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Invalid RESTOCK_SECRET_KEY" });
  });

  it("rejects unknown machines", async () => {
    const { GET } = await import("../../../src/pages/api/restock-data.js");
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");

    const response = await GET({
      url: new URL(
        "https://orble.test/api/restock-data?key=secret&machine=campus&date=2026-07-10",
      ),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unknown machine" });
  });

  it("rejects invalid dates before calling external services", async () => {
    const { GET } = await import("../../../src/pages/api/restock-data.js");
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");
    vi.stubEnv("NAYAX_MACHINE_30TH_ID", "123");

    const response = await GET({
      url: new URL(
        "https://orble.test/api/restock-data?key=secret&machine=30th&date=07-10-2026",
      ),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid date" });
  });

  it("returns a server error when a known machine is missing deployment config", async () => {
    const { GET } = await import("../../../src/pages/api/restock-data.js");
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");

    const response = await GET({
      url: new URL(
        "https://orble.test/api/restock-data?key=secret&machine=30th&date=2026-07-10",
      ),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Machine is not configured" });
  });

  it("recognizes Towne as a known machine", async () => {
    const { GET } = await import("../../../src/pages/api/restock-data.js");
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");

    const response = await GET({
      url: new URL(
        "https://orble.test/api/restock-data?key=secret&machine=towne&date=2026-07-10",
      ),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Machine is not configured" });
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
    const { GET } = await import("../../../src/pages/api/restock-data.js");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlText = String(url);
      if (urlText.includes("Restock%20Log")) {
        return new Response(JSON.stringify({ values: [["Batch ID", "Event"]] }));
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
        "https://orble.test/api/restock-data?key=secret&machine=30th&date=2026-07-10",
      ),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      batchId: "30TH-2026-07-10",
      event: "Load",
      machine: "30TH",
      slots: expect.arrayContaining([
        expect.objectContaining({
          slot: 1,
          previousDrink: "Thai Tea Less Sweet w/ Lychee 16oz",
          flavor: "Thai Tea",
          topping: "Lychee",
          sweetnessLevel: "Less Sweet",
        }),
      ]),
    });
    expect(body.slots[0]).not.toHaveProperty("drink");
  });

  it("returns clearout when requested explicitly", async () => {
    vi.resetModules();
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");
    vi.stubEnv("NAYAX_MACHINE_30TH_ID", "machine-1");
    vi.stubEnv("INVENTORY_SHEET_ID", "inventory-sheet");
    vi.stubEnv("RESTOCK_LOG_SHEET_ID", "restock-log-sheet");
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "sheets-token");
    vi.stubEnv("NAYAX_API_TOKEN", "nayax-token");
    const { GET } = await import("../../../src/pages/api/restock-data.js");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlText = String(url);
      if (urlText.includes("Restock%20Log")) {
        return new Response(JSON.stringify({ values: [["Batch ID", "Event"]] }));
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
        "https://orble.test/api/restock-data?key=secret&machine=30th&date=2026-07-10&mode=clearout",
      ),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      batchId: "30TH-2026-07-10",
      event: "Clearout",
      machine: "30TH",
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
    const { GET } = await import("../../../src/pages/api/restock-data.js");

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

    const response = await GET({
      url: new URL(
        "https://orble.test/api/restock-data?key=secret&machine=30th&date=2026-07-10",
      ),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "This event has already been submitted for this batch.",
      existingEntryRow: 2,
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
    const { GET } = await import("../../../src/pages/api/restock-data.js");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("Restock%20Log")) {
        return new Response(JSON.stringify({ values: [["Batch ID", "Event"]] }));
      }
      return new Response("Forbidden", { status: 403 });
    });

    const response = await GET({
      url: new URL(
        "https://orble.test/api/restock-data?key=secret&machine=30th&date=2026-07-10",
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
