// GET prefill: which event comes next, the batch rules, and the Nayax pending resend.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERRORS } from "../../../src/lib/restock/errors.js";
import { loadPrefill } from "./prefill-setup.js";

describe("prefill: events", () => {
  let buildRestockData;
  let getMachineConfig;

  beforeEach(async () => {
    ({ buildRestockData, getMachineConfig } = await loadPrefill());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns Clearout when explicitly requested for an existing batch", async () => {
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

    const data = await buildRestockData(
      getMachineConfig("30th"),
      "2026-07-10",
      {
        mode: "clearout",
      },
    );

    expect(data.event).toBe("Clearout");
    expect(data.slots[0]).toMatchObject({
      previousDrink: "Thai Tea Less Sweet w/ Lychee 16oz",
      flavor: "Thai Tea",
      topping: "Lychee",
      sweetness: "Less Sweet",
      previous: 1,
      waste: 1,
      expectedNew: 0,
      total: 0,
    });
  });

  it("does not return Clearout when the batch is already cleared out", async () => {
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

    await expect(
      buildRestockData(getMachineConfig("30th"), "2026-07-10", {
        mode: "clearout",
      }),
    ).rejects.toMatchObject({
      status: ERRORS.batchClearedOut.status,
      message: ERRORS.batchClearedOut.message,
    });
  });

  it("warns on a Load for a new date while the machine's last batch has no Topoff", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("Restock%20Log"))
        return new Response(
          JSON.stringify({
            values: [
              ["Batch ID", "Event"],
              ["30th-2026-07-10", "Load"],
            ],
          }),
        );
      if (String(url).includes("Production%20Plan"))
        return new Response(JSON.stringify({ values: [] }));
      return new Response(JSON.stringify([]));
    });

    const data = await buildRestockData(getMachineConfig("30th"), "2026-07-12");

    expect(data.event).toBe("Load");
    expect(data.warnings).toEqual([
      expect.objectContaining({
        code: "OPEN_BATCH_CLEARED_OUT",
        batchId: "30th-2026-07-10",
      }),
    ]);
  });

  it("throws an already submitted error after Load and Topoff exist", async () => {
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

    await expect(
      buildRestockData(getMachineConfig("30th"), "2026-07-10"),
    ).rejects.toMatchObject({
      status: ERRORS.batchFullyLogged.status,
      message: ERRORS.batchFullyLogged.message,
      details: { existingEntryRow: 3 },
    });
  });

  // The submit's own row: Status and the full per-slot state as JSON.
  const SUBMIT_LOG_HEADER = [
    "Batch ID",
    "Event",
    "Date",
    "Duration",
    "Slot Data",
    "Status",
  ];
  const slotDataEntry = (fields) => ({
    Slot: 1,
    Drink: null,
    "Expected Drink": null,
    "Previous Drink": null,
    Previous: 0,
    "Expected Previous": 0,
    Waste: 0,
    "Expected Waste": 0,
    New: 0,
    "Expected New": 0,
    Total: 0,
    ...fields,
  });

  it("prefills a Nayax pending submit from its stored Slot Data so Complete finishes it", async () => {
    vi.stubEnv("RESTOCK_SLOTS_30TH", "1,2");
    const slotData = [
      slotDataEntry({
        Slot: 1,
        Drink: "Matcha 16oz Less Sweet",
        "Expected Drink": "Matcha 16oz Less Sweet",
        "Previous Drink": "Thai Tea 16oz Less Sweet w/ Lychee",
        Previous: 3,
        "Expected Previous": 3,
        Waste: 3,
        "Expected Waste": 3,
        New: 2,
        "Expected New": 3,
        Total: 2,
      }),
      slotDataEntry({ Slot: 2 }),
    ];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url) => {
        const urlText = String(url);
        if (urlText.includes("Restock%20Log")) {
          return new Response(
            JSON.stringify({
              values: [
                SUBMIT_LOG_HEADER,
                [
                  "30th-2026-07-10",
                  "Load",
                  "2026-07-10",
                  "5m 0s",
                  JSON.stringify(slotData),
                  "Nayax pending",
                ],
              ],
            }),
          );
        }
        if (urlText.includes("machineProducts")) {
          // Nayax may already hold the new state; the prefill ignores it.
          return new Response(JSON.stringify([]));
        }
        throw new Error(`Unexpected URL: ${urlText}`);
      });

    const data = await buildRestockData(getMachineConfig("30th"), "2026-07-10");

    expect(data.event).toBe("Load");
    expect(data.slots).toEqual([
      expect.objectContaining({
        slotNumber: 1,
        previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee",
        flavor: "Matcha",
        size: "16oz",
        sweetness: "Less Sweet",
        previous: 3,
        waste: 3,
        expectedNew: 2,
        total: 2,
      }),
      expect.objectContaining({
        slotNumber: 2,
        previousDrink: null,
        flavor: null,
        previous: 0,
        waste: 0,
        expectedNew: 0,
        total: 0,
      }),
    ]);
    // The stored submit is the prefill: no Production Plan read.
    expect(
      fetchSpy.mock.calls.some(([url]) =>
        String(url).includes("Production%20Plan"),
      ),
    ).toBe(false);
  });

  it("refuses a batch that was already cleared out", async () => {
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

    await expect(
      buildRestockData(getMachineConfig("30th"), "2026-07-10"),
    ).rejects.toMatchObject({
      status: ERRORS.batchClearedOut.status,
      message: ERRORS.batchClearedOut.message,
    });
  });

  it("refuses to run against a Restock Log with no header row", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({})),
    );

    await expect(
      buildRestockData(getMachineConfig("30th"), "2026-07-10"),
    ).rejects.toMatchObject({
      status: ERRORS.logHeaderMissing.status,
      message: ERRORS.logHeaderMissing.message,
    });
  });
});
