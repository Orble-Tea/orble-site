import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("GET /api/label-print-data", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("returns label print data from the production plan", async () => {
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "sheets-token");
    vi.stubEnv("PRODUCTION_PLAN_SHEET_ID", "production-plan-sheet");
    const { GET } = await import("../../../src/pages/api/label-print-data.js");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          values: [
            [
              "Recipe",
              "Drink Variation",
              "Amount to Make",
              "Amount to 30TH",
              "Slot (30TH)",
              "Amount to Towne",
              "Slot (Towne)",
            ],
            [
              "Mango Passion Fruit Tea",
              "Mango Passion Fruit Tea 16oz",
              "3",
              "1",
              "21",
              "0",
              "",
            ],
          ],
        }),
      ),
    );

    const response = await GET({
      url: new URL("https://orble.test/api/label-print-data?key=secret"),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      rows: [
        {
          drinkName: "Mango Passion Fruit Tea 16oz",
          labels: [
            {
              code: "30TH#21",
              expirationDate: "09/28/26",
              drinkName: "Mango Passion Fruit Tea 16oz",
            },
            { code: "" },
            { code: "" },
            { code: "" },
          ],
        },
      ],
    });
  });

  it("logs upstream failures but returns only a generic public error", async () => {
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "sheets-token");
    vi.stubEnv("PRODUCTION_PLAN_SHEET_ID", "production-plan-sheet");
    const { GET } = await import("../../../src/pages/api/label-print-data.js");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 503 }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET({
      url: new URL("https://orble.test/api/label-print-data?key=secret"),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Internal server error",
    });
    expect(console.error).toHaveBeenCalled();
  });
});
