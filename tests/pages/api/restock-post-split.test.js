import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESTOCK_LOG_HEADER } from "../../../src/lib/restock/config.js";

const DATE = "2026-07-10";
const BATCH_ID = `Kitchen-${DATE}`;
const THAI = "Thai Tea 16oz Less Sweet w/ Lychee";
const MATCHA = "Matcha 16oz Less Sweet";

function makeRequest(body) {
  return new Request("https://orble.test/api/restock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key: "secret",
      batchId: BATCH_ID,
      event: "Split",
      duration: "1m 0s",
      ...body,
    }),
  });
}

/** Fake Sheets. Every call is recorded with its body so writes can be checked. */
function installFakes({ logRows = [], inventory } = {}) {
  const calls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init = {}) => {
    const url = decodeURIComponent(String(input));
    const method = (init.method || "GET").toUpperCase();
    calls.push({ method, url, body: init.body ? JSON.parse(init.body) : null });
    const ok = (data) => new Response(JSON.stringify(data));
    if (method === "POST")
      return ok({ updates: { updatedRange: "'Restock Log'!A2:F2" } });
    if (method !== "GET") return ok({});
    if (url.includes("Restock Log"))
      return ok({ values: [Object.values(RESTOCK_LOG_HEADER), ...logRows] });
    if (url.includes("inventory-sheet")) {
      if (url.includes("/values/"))
        return ok({
          values: inventory ?? [
            ["Drink", "Storage", "To 30th", "To Towne"],
            [THAI, 6, "", ""],
            ["", "", "", ""],
            [MATCHA, 1, "", ""],
          ],
        });
      return ok({ sheets: [{ properties: { title: "07/10/2026" } }] });
    }
    throw new Error(`Unexpected ${method} ${url}`);
  });
  return calls;
}

const writes = (calls) => calls.filter((c) => c.method !== "GET");

describe("POST /api/restock for a Split", () => {
  let POST;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");
    vi.stubEnv("INVENTORY_SHEET_ID", "inventory-sheet");
    vi.stubEnv("RESTOCK_LOG_SHEET_ID", "restock-log-sheet");
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "sheets-token");
    ({ POST } = await import("../../../src/pages/api/restock.js"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("writes each machine's To column onto the Inventory tab and appends one Complete Split row", async () => {
    const calls = installFakes();

    const response = await POST({
      request: makeRequest({
        drinks: [
          { drink: THAI, to30th: 3, toTowne: 3 },
          { drink: MATCHA, to30th: 1, toTowne: 0 },
        ],
      }),
    });

    expect(response.status).toBe(200);
    const [to30th, toTowne, log] = writes(calls);
    // Column C rows 2-4: Thai, the blank row left as it was, Matcha
    expect(to30th.method).toBe("PUT");
    expect(to30th.url).toContain("!C2:C4");
    expect(to30th.body.values).toEqual([[3], [""], [1]]);
    expect(toTowne.url).toContain("!D2:D4");
    expect(toTowne.body.values).toEqual([[3], [""], [0]]);
    expect(log.method).toBe("POST");
    expect(log.url).toContain("Restock Log");
    expect(log.body.values).toEqual([
      [
        BATCH_ID,
        "Split",
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        "1m 0s",
        "",
        "Complete",
      ],
    ]);
  });

  it("refuses a drink the Inventory tab does not list, before any write", async () => {
    const calls = installFakes();

    const response = await POST({
      request: makeRequest({
        drinks: [
          { drink: THAI, to30th: 3, toTowne: 3 },
          { drink: MATCHA, to30th: 1, toTowne: 0 },
          { drink: "Horchata 16oz", to30th: 2, toTowne: 0 },
        ],
      }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Horchata 16oz/);
    expect(writes(calls)).toEqual([]);
  });

  it("refuses a submission that leaves out an Inventory drink", async () => {
    const calls = installFakes();

    const response = await POST({
      request: makeRequest({
        drinks: [{ drink: THAI, to30th: 3, toTowne: 3 }],
      }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Matcha 16oz Less Sweet/);
    expect(writes(calls)).toEqual([]);
  });

  it("refuses shares that add up to more than the storage", async () => {
    const calls = installFakes();

    const response = await POST({
      request: makeRequest({
        drinks: [
          { drink: THAI, to30th: 4, toTowne: 3 },
          { drink: MATCHA, to30th: 1, toTowne: 0 },
        ],
      }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(
      /Thai Tea 16oz Less Sweet w\/ Lychee/,
    );
    expect(writes(calls)).toEqual([]);
  });

  it("refuses a second Split for the same kitchen batch", async () => {
    const calls = installFakes({
      logRows: [[BATCH_ID, "Split", DATE, "1m 0s", "", "Complete"]],
    });

    const response = await POST({
      request: makeRequest({
        drinks: [
          { drink: THAI, to30th: 3, toTowne: 3 },
          { drink: MATCHA, to30th: 1, toTowne: 0 },
        ],
      }),
    });

    expect(response.status).toBe(409);
    expect(writes(calls)).toEqual([]);
  });

  it("refuses a batch id that is not a kitchen batch, or a share that is not a count", async () => {
    installFakes();

    const wrongBatch = await POST({
      request: makeRequest({
        batchId: `30th-${DATE}`,
        drinks: [{ drink: THAI, to30th: 3, toTowne: 3 }],
      }),
    });
    expect(wrongBatch.status).toBe(400);

    const badShare = await POST({
      request: makeRequest({
        drinks: [
          { drink: THAI, to30th: -1, toTowne: 3 },
          { drink: MATCHA, to30th: 1, toTowne: 0 },
        ],
      }),
    });
    expect(badShare.status).toBe(400);
  });

  it("tells the kitchen when the Inventory tab has no To column to write into", async () => {
    const calls = installFakes({
      inventory: [
        ["Drink", "Storage"],
        [THAI, 6],
        [MATCHA, 1],
      ],
    });

    const response = await POST({
      request: makeRequest({
        drinks: [
          { drink: THAI, to30th: 3, toTowne: 3 },
          { drink: MATCHA, to30th: 1, toTowne: 0 },
        ],
      }),
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/To 30th/);
    expect(writes(calls)).toEqual([]);
  });
});
