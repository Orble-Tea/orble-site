import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe("integration Sheets fixtures", () => {
  let client;
  let requests;
  let respond;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "test@example.test");
    vi.stubEnv("GOOGLE_PRIVATE_KEY", pem);
    requests = [];
    respond = () => new Response(JSON.stringify({}));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, options = {}) => {
        if (String(url).includes("oauth2.googleapis.com")) {
          return new Response(
            JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
          );
        }
        requests.push({ url: String(url), ...options });
        return respond(requests.at(-1));
      }),
    );
    client = await import("../integration/support/google-sheets-client.js");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("retries a throttled cleanup with exponential delays and identical request data", async () => {
    respond = () =>
      requests.length < 3
        ? new Response("quota exceeded", { status: 429 })
        : new Response(null, { status: 204 });
    const started = Date.now();
    const cleanup = client.clearSheetRange("test-sheet", "Production Plan");
    await vi.runAllTimersAsync();
    await expect(cleanup).resolves.toBeNull();
    expect(Date.now() - started).toBe(3000);
    expect(requests).toHaveLength(3);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[2]).toEqual(requests[0]);
  });

  it("bounds retries and reports the final quota failure", async () => {
    respond = () => new Response("still throttled", { status: 429 });
    const started = Date.now();
    const failed = expect(
      client.clearSheetRange("test-sheet", "Production Plan"),
    ).rejects.toThrow("429: still throttled");
    await vi.runAllTimersAsync();
    await failed;
    expect(requests).toHaveLength(7);
    expect(Date.now() - started).toBe(63000);
  });

  it.each([400, 403, 500])(
    "fails status %s without retrying",
    async (status) => {
      respond = () => new Response("request rejected", { status });
      await expect(
        client.clearSheetRange("test-sheet", "Production Plan"),
      ).rejects.toThrow(`${status}: request rejected`);
      expect(requests).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("replaces fixture values in one write while preserving literal cell types", async () => {
    respond = (request) =>
      new Response(
        JSON.stringify(
          request.method
            ? {}
            : {
                sheets: [
                  { properties: { title: "Production Plan", sheetId: 0 } },
                ],
              },
        ),
      );
    await client.seedSheet("test-sheet", "Production Plan", [
      ["=literal", 4, 0, false, "", null],
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[1].url).toBe(
      "https://sheets.googleapis.com/v4/spreadsheets/test-sheet:batchUpdate",
    );
    expect(JSON.parse(requests[1].body)).toEqual({
      requests: [
        {
          updateCells: {
            range: { sheetId: 0 },
            fields: "userEnteredValue",
            rows: [
              {
                values: [
                  { userEnteredValue: { stringValue: "=literal" } },
                  { userEnteredValue: { numberValue: 4 } },
                  { userEnteredValue: { numberValue: 0 } },
                  { userEnteredValue: { boolValue: false } },
                  {},
                  {},
                ],
              },
            ],
          },
        },
      ],
    });
    await client.seedSheet("test-sheet", "Production Plan", []);
    expect(requests).toHaveLength(3);
    expect(JSON.parse(requests[2].body).requests[0].updateCells.rows).toEqual(
      [],
    );
  });

  it("uses the new sheet ID when a fixture tab must be created", async () => {
    respond = (request) => {
      if (!request.method) return new Response(JSON.stringify({ sheets: [] }));
      const creating = JSON.parse(request.body).requests[0].addSheet;
      return new Response(
        JSON.stringify(
          creating
            ? { replies: [{ addSheet: { properties: { sheetId: 12 } } }] }
            : {},
        ),
      );
    };
    await client.seedSheet("test-sheet", "Production Plan", [["Drink"]]);
    expect(requests).toHaveLength(3);
    expect(JSON.parse(requests[2].body).requests[0].updateCells.range).toEqual({
      sheetId: 12,
    });
  });
});
