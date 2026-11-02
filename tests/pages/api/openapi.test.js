import { afterEach, describe, expect, it, vi } from "vitest";

describe("GET /api/openapi.json", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects requests with an invalid secret key", async () => {
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");
    const { GET } = await import("../../../src/pages/api/openapi.json.js");
    const response = await GET({
      url: new URL("https://orble.test/api/openapi.json?key=bad"),
    });
    expect(response.status).toBe(403);
  });

  it("serves the document with the request origin as the server", async () => {
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");
    const { GET } = await import("../../../src/pages/api/openapi.json.js");
    const response = await GET({
      url: new URL("https://orble.test/api/openapi.json?key=secret"),
    });
    expect(response.status).toBe(200);
    const doc = await response.json();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.servers).toEqual([{ url: "https://orble.test" }]);
  });
});
