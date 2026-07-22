import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appendSheetRows,
  columnToLetter,
  getHeaderIndex,
  readSheetValues,
  rowsToObjects,
  updateSheetValues,
} from "./google-sheets.js";

describe("Google Sheets helpers", () => {
  beforeEach(() => {
    process.env.GOOGLE_SHEETS_ACCESS_TOKEN = "google-token";
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GOOGLE_SHEETS_ACCESS_TOKEN;
  });

  it("converts sheet rows to objects by header", () => {
    expect(
      rowsToObjects([
        ["Drink", "Storage"],
        ["Thai Tea", 3],
      ]),
    ).toEqual([{ _rowNumber: 2, Drink: "Thai Tea", Storage: 3 }]);
  });

  it("finds headers case-insensitively and converts columns to letters", () => {
    expect(getHeaderIndex(["Drink", "Storage"], "storage")).toBe(1);
    expect(columnToLetter(1)).toBe("A");
    expect(columnToLetter(28)).toBe("AB");
  });

  it("reads values with bearer auth", async () => {
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ values: [["Drink"], ["Thai Tea"]] }), {
        status: 200,
      }),
    );

    await expect(readSheetValues("sheet-id", "Restock Log")).resolves.toEqual([
      ["Drink"],
      ["Thai Tea"],
    ]);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/sheet-id/values/'Restock%20Log'"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer google-token",
        }),
      }),
    );
  });

  it("appends and updates sheet values", async () => {
    fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ updatedRows: 1 }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ updatedRows: 1 }), { status: 200 }),
      );

    await appendSheetRows("sheet-id", "Restock Log", [["row"]]);
    await updateSheetValues("sheet-id", "Restock Log", "A2", [["updated"]]);

    expect(fetch.mock.calls[0][0]).toContain(
      ":append?valueInputOption=USER_ENTERED",
    );
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ values: [["row"]] }),
    });
    expect(fetch.mock.calls[1][0]).toContain(
      "!A2?valueInputOption=USER_ENTERED",
    );
    expect(fetch.mock.calls[1][1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ values: [["updated"]] }),
    });
  });

  it("skips empty append batches and surfaces Google API errors", async () => {
    await expect(
      appendSheetRows("sheet-id", "Restock Log", []),
    ).resolves.toBeNull();

    fetch.mockResolvedValueOnce(new Response("nope", { status: 403 }));
    await expect(readSheetValues("sheet-id", "Restock Log")).rejects.toThrow(
      "Google Sheets request failed: nope",
    );
  });
});
