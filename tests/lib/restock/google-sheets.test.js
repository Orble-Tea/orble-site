import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";

import {
  appendSheetValues,
  readLatestSheetValues,
  readSheetValues,
  rowsToObjects,
  updateSheetValues,
} from "../../../src/lib/restock/google-sheets.js";

describe("google sheets helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("reads sheet values with an access token", async () => {
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "sheets-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ values: [["Drink"], ["Thai Tea"]] }), {
        status: 200,
      }),
    );

    await expect(
      readSheetValues("sheet-id", "Production Plan"),
    ).resolves.toEqual([["Drink"], ["Thai Tea"]]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://sheets.googleapis.com/v4/spreadsheets/sheet-id/values/'Production%20Plan'",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sheets-token",
        }),
      }),
    );
  });

  it("appends and updates sheet values", async () => {
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "sheets-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ updates: { updatedRange: "'Restock Log'!A2:J2" } }),
          {
            status: 200,
          },
        ),
    );

    await appendSheetValues("sheet-id", "Restock Log", [["batch", "Load"]]);
    await updateSheetValues("sheet-id", "Inventory", "B2", [[0]]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://sheets.googleapis.com/v4/spreadsheets/sheet-id/values/'Restock%20Log':append?valueInputOption=USER_ENTERED",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ values: [["batch", "Load"]] }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://sheets.googleapis.com/v4/spreadsheets/sheet-id/values/'Inventory'!B2?valueInputOption=USER_ENTERED",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ values: [[0]] }),
      }),
    );
  });

  it("turns rows into objects with row numbers", () => {
    expect(
      rowsToObjects([
        ["Drink", "Amount"],
        ["Thai Tea", 4],
      ]),
    ).toEqual([{ _rowNumber: 2, Drink: "Thai Tea", Amount: 4 }]);
  });

  it("throws on Google Sheets errors", async () => {
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "sheets-token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("No access", { status: 403 }),
    );

    await expect(
      readSheetValues("sheet-id", "Production Plan"),
    ).rejects.toMatchObject({
      message: "Google Sheets request failed while reading Production Plan",
      upstream: true,
      details: {
        service: "google_sheets",
        operation: "reading Production Plan",
        sheetName: "Production Plan",
        status: 403,
        authMode: "access_token",
      },
    });
  });

  it("reads values from the newest date-named sheet in a workbook", async () => {
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "sheets-token");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sheets: [
              { properties: { title: "Sheet1", index: 0 } },
              { properties: { title: "09/02/2026", index: 1 } },
              { properties: { title: "08/24/2026", index: 2 } },
              { properties: { title: "08/21/2026", index: 3 } },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ values: [["Drink"], ["Thai Tea"]] }), {
          status: 200,
        }),
      );

    await expect(readLatestSheetValues("sheet-id")).resolves.toEqual([
      ["Drink"],
      ["Thai Tea"],
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://sheets.googleapis.com/v4/spreadsheets/sheet-id",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sheets-token",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://sheets.googleapis.com/v4/spreadsheets/sheet-id/values/'09%2F02%2F2026'",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sheets-token",
        }),
      }),
    );
  });

  it("can request a service-account token before reading sheets", async () => {
    vi.resetModules();
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "svc@example.com");
    vi.stubEnv(
      "GOOGLE_PRIVATE_KEY",
      privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString()
        .replace(/\n/g, "\\n"),
    );
    vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "");
    const { readSheetValues: readValuesWithServiceAccount } = await import(
      "../../../src/lib/restock/google-sheets.js"
    );

    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "jwt-token", expires_in: 3600 }),
          {
            status: 200,
          },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    await expect(
      readValuesWithServiceAccount("sheet-id", "Missing Values"),
    ).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
