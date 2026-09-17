import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makeRequest(body) {
  return new Request("https://orble.test/api/restock-submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const validBody = {
  key: "secret",
  batchId: "30TH-2026-07-10",
  event: "Load",
  machine: "30TH",
  date: "2026-07-10",
  slots: [{ slot: 1, waste: 2, new: 4 }],
};

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
      request: makeRequest({ ...validBody, key: "bad" }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Invalid RESTOCK_SECRET_KEY",
    });
  });

  it("rejects malformed JSON bodies", async () => {
    const { POST } = await import("../../../src/pages/api/restock-submit.js");
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");

    const response = await POST({ request: makeRequest("{not json") });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON body" });
  });

  it("rejects bodies missing required fields", async () => {
    const { POST } = await import("../../../src/pages/api/restock-submit.js");
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");

    const { slots, ...withoutSlots } = validBody;
    const response = await POST({ request: makeRequest(withoutSlots) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Missing required fields" });
  });

  it("acknowledges a valid submission", async () => {
    const { POST } = await import("../../../src/pages/api/restock-submit.js");
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");

    const response = await POST({ request: makeRequest(validBody) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      message: "Restock complete",
    });
  });
});
