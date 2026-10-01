import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("GET /api/label-print-data", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("rejects requests with an invalid secret key", async () => {
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");
    const { GET } = await import("../../../src/pages/api/label-print-data.js");

    const response = await GET({
      url: new URL("https://orble.test/api/label-print-data?key=bad"),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Invalid RESTOCK_SECRET_KEY" });
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
              "Date",
            ],
            [
              "Mango Passion Fruit Tea",
              "Mango Passion Fruit Tea 16oz",
              "3",
              "1",
              "21",
              "0",
              "",
              "09/21/26",
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
      recipeCount: 1,
      totalLabels: 3,
      recipes: [
        {
          recipe: "Mango Passion Fruit Tea",
          totalLabels: 3,
          labels: [
            {
              code: "30TH#21",
              expirationDate: "09/28/26",
              drinkName: "Mango Passion Fruit Tea 16oz",
            },
            { code: "" },
            { code: "" },
          ],
        },
      ],
    });
  });

  it("returns upstream errors from Google Sheets reads", async () => {
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "sheets-token");
    vi.stubEnv("PRODUCTION_PLAN_SHEET_ID", "production-plan-sheet");
    const { GET } = await import("../../../src/pages/api/label-print-data.js");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 503 }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET({
      url: new URL("https://orble.test/api/label-print-data?key=secret"),
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: "Google Sheets request failed while reading Production Plan",
      details: {
        service: "google_sheets",
        operation: "reading Production Plan",
        status: 503,
      },
    });
  });

  it("returns server errors for missing deployment config", async () => {
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");
    const { GET } = await import("../../../src/pages/api/label-print-data.js");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET({
      url: new URL("https://orble.test/api/label-print-data?key=secret"),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Missing required environment variable: PRODUCTION_PLAN_SHEET_ID",
    });
  });
});
