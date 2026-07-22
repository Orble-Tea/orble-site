import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function readJson(response) {
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function importRoutes() {
  vi.resetModules();
  process.env.RESTOCK_MOCK = "true";
  process.env.RESTOCK_SECRET_KEY = "secret";
  return {
    restockData: await import("./restock-data.js"),
    restockSubmit: await import("./restock-submit.js"),
    picklist: await import("./picklist.js"),
  };
}

describe("restock API routes", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.RESTOCK_MOCK;
    delete process.env.RESTOCK_SECRET_KEY;
  });

  it("rejects requests w/ invalid key", async () => {
    const { restockData } = await importRoutes();
    const response = await restockData.GET({
      url: new URL(
        "https://orble.test/api/restock-data?key=bad&machine=towne&date=2026-07-10",
      ),
    });

    expect(await readJson(response)).toEqual({
      status: 403,
      body: { error: "Invalid key" },
    });
  });

  it("rejects unknown machines", async () => {
    const { restockData } = await importRoutes();
    const response = await restockData.GET({
      url: new URL(
        "https://orble.test/api/restock-data?key=secret&machine=campus&date=2026-07-10",
      ),
    });

    expect(await readJson(response)).toEqual({
      status: 400,
      body: { error: "Unknown machine" },
    });
  });

  it("returns mock restock data for valid requests in mock", async () => {
    const { restockData } = await importRoutes();
    const response = await restockData.GET({
      url: new URL(
        "https://orble.test/api/restock-data?key=secret&machine=towne&date=2026-07-10",
      ),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      batchId: "Towne-2026-07-10",
      event: "Load",
      machine: "Towne",
      date: "2026-07-10",
    });
    expect(body.slots).toHaveLength(35);
  });

  it("rejects invalid dates", async () => {
    const { restockData } = await importRoutes();
    const response = await restockData.GET({
      url: new URL(
        "https://orble.test/api/restock-data?key=secret&machine=towne&date=07-10-2026",
      ),
    });

    expect(await readJson(response)).toEqual({
      status: 400,
      body: { error: "Invalid date" },
    });
  });

  it("rejects invalid JSON bodies on submit", async () => {
    const { restockSubmit } = await importRoutes();
    const response = await restockSubmit.POST({
      request: new Request("https://orble.test/api/restock-submit", {
        method: "POST",
        body: "{bad json",
      }),
    });

    expect(await readJson(response)).toEqual({
      status: 400,
      body: { error: "Invalid JSON body" },
    });
  });

  it("returns mock submit responses for valid requests", async () => {
    const { restockSubmit } = await importRoutes();
    const payload = {
      key: "secret",
      machine: "towne",
      batchId: "Towne-2026-07-10",
      event: "Load",
      date: "2026-07-10",
      duration: "5m 32s",
      slots: [{ slot: 1, waste: 3, new: 4 }],
    };
    const response = await restockSubmit.POST({
      request: new Request("https://orble.test/api/restock-submit", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      mock: true,
      received: {
        batchId: payload.batchId,
        event: payload.event,
        machine: payload.machine,
      },
    });
  });

  it("rejects invalid submit events and slots", async () => {
    const { restockSubmit } = await importRoutes();
    const invalidEvent = await restockSubmit.POST({
      request: new Request("https://orble.test/api/restock-submit", {
        method: "POST",
        body: JSON.stringify({
          key: "secret",
          machine: "towne",
          event: "Clearout",
          date: "2026-07-10",
          slots: [],
        }),
      }),
    });
    const invalidSlots = await restockSubmit.POST({
      request: new Request("https://orble.test/api/restock-submit", {
        method: "POST",
        body: JSON.stringify({
          key: "secret",
          machine: "towne",
          event: "Load",
          date: "2026-07-10",
          slots: "not-array",
        }),
      }),
    });

    expect(await readJson(invalidEvent)).toEqual({
      status: 400,
      body: { error: "Invalid event" },
    });
    expect(await readJson(invalidSlots)).toEqual({
      status: 400,
      body: { error: "Slots must be an array" },
    });
  });

  it("returns mock picklists for valid picklist requests", async () => {
    const { picklist } = await importRoutes();
    const response = await picklist.GET({
      url: new URL(
        "https://orble.test/api/picklist?key=secret&date=2026-07-10",
      ),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.date).toBe("2026-07-10");
    expect(body.machines.map((machine) => machine.machine)).toEqual([
      "Towne",
      "30th",
    ]);
  });

  it("rejects invalid picklist dates", async () => {
    const { picklist } = await importRoutes();
    const response = await picklist.GET({
      url: new URL("https://orble.test/api/picklist?key=secret&date=today"),
    });

    expect(await readJson(response)).toEqual({
      status: 400,
      body: { error: "Invalid date" },
    });
  });
});
