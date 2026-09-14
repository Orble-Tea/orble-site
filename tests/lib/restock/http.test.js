import { describe, expect, it } from "vitest";

import {
  badRequest,
  conflict,
  invalidKey,
  json,
  parseJson,
  serverError,
  upstreamError,
} from "../../../src/lib/restock/http.js";

describe("http helpers", () => {
  it("returns no-store JSON responses", async () => {
    const response = json({ ok: true }, 201);

    expect(response.status).toBe(201);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("formats shared error responses", async () => {
    await expect(invalidKey().json()).resolves.toEqual({
      error: "Invalid RESTOCK_SECRET_KEY",
    });
    await expect(badRequest("Bad input").json()).resolves.toEqual({ error: "Bad input" });
    await expect(conflict("Already submitted", 12).json()).resolves.toEqual({
      error: "Already submitted",
      existingEntryRow: 12,
    });
    await expect(serverError().json()).resolves.toEqual({ error: "Internal server error" });
    await expect(
      upstreamError("NAYAX_API_TOKEN is not authorized", {
        service: "nayax",
        status: 403,
      }).json(),
    ).resolves.toEqual({
      error: "NAYAX_API_TOKEN is not authorized",
      details: {
        service: "nayax",
        status: 403,
      },
    });
  });

  it("parses valid JSON and rejects invalid JSON", async () => {
    await expect(
      parseJson(new Request("https://orble.test", { method: "POST", body: '{"ok":true}' })),
    ).resolves.toEqual({ ok: true });
    await expect(
      parseJson(new Request("https://orble.test", { method: "POST", body: "{bad" })),
    ).rejects.toThrow("Invalid JSON body");
  });
});
