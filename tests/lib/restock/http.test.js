import { describe, expect, it } from "vitest";

import {
  ERRORS,
  RestockError,
  UpstreamServiceError,
  couldntSubmit,
} from "../../../src/lib/restock/errors.js";
import {
  errorResponse,
  json,
  parseJson,
} from "../../../src/lib/restock/http.js";

describe("http helpers", () => {
  it("returns no-store JSON responses", async () => {
    const response = json({ ok: true }, 201);

    expect(response.status).toBe(201);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("answers a RestockError with its own status, message, and details", async () => {
    const plain = errorResponse(new RestockError(ERRORS.invalidKey));
    expect(plain.status).toBe(ERRORS.invalidKey.status);
    await expect(plain.json()).resolves.toEqual({
      error: ERRORS.invalidKey.message,
    });
    expect(couldntSubmit("slot 12: new 9 exceeds the 6 free")).toBe(
      "Couldn't submit: slot 12: new 9 exceeds the 6 free. Your current draft is saved on page refreshes.",
    );

    const withDetails = errorResponse(
      new RestockError(ERRORS.alreadySubmitted, { existingEntryRow: 12 }),
    );
    expect(withDetails.status).toBe(409);
    await expect(withDetails.json()).resolves.toEqual({
      error: ERRORS.alreadySubmitted.message,
      details: { existingEntryRow: 12 },
    });

    const upstream = errorResponse(
      new UpstreamServiceError("NAYAX_API_TOKEN is not authorized", {
        service: "nayax",
        status: 403,
      }),
    );
    expect(upstream.status).toBe(502);
    await expect(upstream.json()).resolves.toEqual({
      error: "NAYAX_API_TOKEN is not authorized",
      details: { service: "nayax", status: 403 },
    });
  });

  it("answers any other error as a generic 500", async () => {
    const response = errorResponse(
      new Error("GOOGLE_PRIVATE_KEY is unreadable"),
    );
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: ERRORS.internal.message,
    });
  });

  it("parses valid JSON and rejects invalid JSON as a 400", async () => {
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
    ).rejects.toMatchObject({
      status: ERRORS.invalidJson.status,
      message: ERRORS.invalidJson.message,
    });
  });
});
