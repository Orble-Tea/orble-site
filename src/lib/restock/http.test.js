import { describe, expect, it } from "vitest";

import { badRequest, conflict, invalidKey, json, parseJson } from "./http.js";

describe("HTTP helpers", () => {
  it("returns no-store JSON responses", async () => {
    const response = json({ ok: true }, 201);

    expect(response.status).toBe(201);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("builds standard error responses", async () => {
    await expect(invalidKey().json()).resolves.toEqual({
      error: "Invalid key",
    });
    await expect(badRequest("Invalid date").json()).resolves.toEqual({
      error: "Invalid date",
    });
    await expect(
      conflict("Already submitted", "#gid=0&range=A2:J2").json(),
    ).resolves.toEqual({
      error: "Already submitted",
      existingEntryUrl: "#gid=0&range=A2:J2",
    });
  });

  it("parses valid JSON and reports invalid JSON bodies", async () => {
    await expect(
      parseJson(
        new Request("https://orble.test", {
          method: "POST",
          body: '{"ok":true}',
        }),
      ),
    ).resolves.toEqual({ ok: true });

    await expect(
      parseJson(
        new Request("https://orble.test", { method: "POST", body: "{bad" }),
      ),
    ).rejects.toThrow("Invalid JSON body");
  });
});
