import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonRequest(body) {
  return new Request("https://orble.test/api/restock-submit", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/restock-submit", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("rejects requests with an invalid secret key", async () => {
    const { POST } = await import("../../../src/pages/api/restock-submit.js");
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");

    const response = await POST({
      request: jsonRequest({ key: "bad", machine: "30TH" }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Invalid RESTOCK_SECRET_KEY",
    });
  });

  it("rejects unknown machines", async () => {
    const { POST } = await import("../../../src/pages/api/restock-submit.js");
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");

    const response = await POST({
      request: jsonRequest({ key: "secret", machine: "Campus" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unknown machine" });
  });

  it("submits a valid restock request", async () => {
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");
    vi.stubEnv("NAYAX_MACHINE_30TH_ID", "machine-1");
    vi.stubEnv("PRODUCTION_PLAN_SHEET_ID", "production-plan-sheet");
    vi.stubEnv("INVENTORY_SHEET_ID", "inventory-sheet");
    vi.stubEnv("RESTOCK_LOG_SHEET_ID", "restock-log-sheet");
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "sheets-token");
    vi.stubEnv("NAYAX_API_TOKEN", "nayax-token");
    const { POST } = await import("../../../src/pages/api/restock-submit.js");

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (url, options = {}) => {
        const urlText = String(url);
        const method = options.method || "GET";

        if (urlText.includes("'Restock%20Log':append")) {
          return new Response(
            JSON.stringify({
              updates: { updatedRange: "'Restock Log'!A2:J3" },
            }),
          );
        }
        if (urlText.includes("'Visits':append")) {
          return new Response(
            JSON.stringify({ updates: { updatedRange: "'Visits'!A2:C2" } }),
          );
        }
        if (urlText.includes("'Restock%20Log'")) {
          return new Response(
            JSON.stringify({ values: [["Batch ID", "Event"]] }),
          );
        }
        if (urlText.includes("Production%20Plan")) {
          return new Response(
            JSON.stringify({
              values: [
                [
                  "Drink Variation",
                  "Amount to 30TH",
                  "Slot (30TH)",
                  "NayaxProductID",
                ],
                ["Thai Tea Less Sweet w/ Lychee 16oz", 4, "1", "np-1"],
              ],
            }),
          );
        }
        if (urlText.includes("machineProducts") && method === "PUT") {
          return new Response(JSON.stringify({ ok: true }));
        }
        if (urlText.includes("machineProducts")) {
          return new Response(
            JSON.stringify([
              {
                MachineProductID: "mp-1",
                NayaxProductID: "np-1",
                MDBCode: 1,
                PAR: 4,
                MissingStockByMDB: 2,
                DEXProductName: "Thai Tea Less Sweet w/ Lychee 16oz",
              },
            ]),
          );
        }
        throw new Error(`Unexpected URL: ${urlText}`);
      },
    );

    const response = await POST({
      request: jsonRequest({
        key: "secret",
        batchId: "30TH-2026-07-10",
        event: "Load",
        machine: "30TH",
        date: "2026-07-10",
        duration: "5m 32s",
        slots: [{ slot: 1, waste: 2, new: 4 }],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      message: "Restock complete",
    });
  });

  it("returns a conflict when the event was already submitted", async () => {
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");
    vi.stubEnv("NAYAX_MACHINE_30TH_ID", "machine-1");
    vi.stubEnv("RESTOCK_LOG_SHEET_ID", "restock-log-sheet");
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "sheets-token");
    const { POST } = await import("../../../src/pages/api/restock-submit.js");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          values: [
            ["Batch ID", "Event"],
            ["30TH-2026-07-10", "Load"],
          ],
        }),
      ),
    );

    const response = await POST({
      request: jsonRequest({
        key: "secret",
        batchId: "30TH-2026-07-10",
        event: "Load",
        machine: "30TH",
        date: "2026-07-10",
        duration: "5m 32s",
        slots: [{ slot: 1, waste: 2, new: 4 }],
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "This Load has already been submitted.",
      existingEntryRow: 2,
      existingEntryUrl:
        "https://docs.google.com/spreadsheets/d/restock-log-sheet/edit#range=A2",
    });
  });
});
