import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendSheetRows: vi.fn(),
  createMachineProducts: vi.fn(),
  getMachineProducts: vi.fn(),
  readSheetValues: vi.fn(),
  sendRestockSlack: vi.fn(),
  updateMachineProducts: vi.fn(),
  updateSheetValues: vi.fn(),
}));

vi.mock("./google-sheets.js", () => ({
  appendSheetRows: mocks.appendSheetRows,
  columnToLetter: (columnNumber) => String.fromCharCode(64 + columnNumber),
  getHeaderIndex: (headers, header) =>
    headers.findIndex(
      (candidate) =>
        String(candidate).trim().toLowerCase() === header.toLowerCase(),
    ),
  readSheetValues: mocks.readSheetValues,
  rowsToObjects: (values) => {
    const [headers = [], ...rows] = values;
    return rows.map((row, index) => {
      const object = { _rowNumber: index + 2 };
      headers.forEach((header, columnIndex) => {
        object[String(header).trim()] = row[columnIndex] ?? "";
      });
      return object;
    });
  },
  updateSheetValues: mocks.updateSheetValues,
}));

vi.mock("./nayax.js", () => ({
  createMachineProducts: mocks.createMachineProducts,
  getMachineProductId: (product) =>
    product.MachineProductID ?? product.machineProductId,
  getMachineProducts: mocks.getMachineProducts,
  getNayaxProductId: (product) =>
    product.NayaxProductID ?? product.nayaxProductId,
  getProductName: (product) =>
    String(product.DEXProductName ?? product.dexProductName ?? "").trim(),
  getProductPar: (product) => Number(product.PAR ?? product.par ?? 0) || 0,
  getProductSlot: (product) =>
    Number(product.MDBCode ?? product.mdbCode ?? product.slot),
  updateMachineProducts: mocks.updateMachineProducts,
}));

vi.mock("./slack.js", () => ({
  sendRestockSlack: mocks.sendRestockSlack,
}));

const machineConfig = {
  key: "towne",
  label: "Towne",
  machineId: "machine-1",
  amountHeader: "Amount to Towne",
  slotHeader: "Slot (Towne)",
};

const restockHeader = [
  "Batch ID",
  "Event",
  "Date",
  "Slot",
  "Drink",
  "Previous",
  "Waste",
  "New",
  "Total",
  "Expected",
];

const productionPlan = [
  ["Recipe", "Variation", "Amount to Towne", "Slot (Towne)"],
  ["Thai Tea", "Thai Tea Less Sweet w/ Lychee 16oz", 6, "1,2"],
  ["Taro", "Taro Normal 22oz", 0, ""],
];

describe("restock service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendSheetRows.mockResolvedValue({});
    mocks.createMachineProducts.mockResolvedValue({});
    mocks.sendRestockSlack.mockResolvedValue({});
    mocks.updateMachineProducts.mockResolvedValue({});
    mocks.updateSheetValues.mockResolvedValue({});
    process.env.NAYAX_DEFAULT_CASH_PRICE = "5";
    process.env.NAYAX_DEFAULT_CARD_PRICE = "5";
  });

  it("determines load when no load has been logged for the batch", async () => {
    mocks.readSheetValues.mockResolvedValueOnce([restockHeader]);
    const { determineEvent } = await import("./restock-service.js");

    await expect(determineEvent("Towne-2026-07-10")).resolves.toBe("Load");
  });

  it("determines topoff after load has been logged", async () => {
    mocks.readSheetValues.mockResolvedValueOnce([
      restockHeader,
      ["Towne-2026-07-10", "Load", "2026-07-10", 1],
    ]);
    const { determineEvent } = await import("./restock-service.js");

    await expect(determineEvent("Towne-2026-07-10")).resolves.toBe("Topoff");
  });

  it("builds load prefill data from production plan slots and current Nayax counts", async () => {
    mocks.readSheetValues.mockImplementation(
      async (_spreadsheetId, sheetName) => {
        if (sheetName === "Restock Log") return [restockHeader];
        if (sheetName === "Production Plan") return productionPlan;
        return [];
      },
    );
    mocks.getMachineProducts.mockResolvedValue([
      {
        MachineProductID: 11,
        NayaxProductID: 101,
        MDBCode: 1,
        PAR: 3,
        DEXProductName: "Old Drink 16oz",
      },
    ]);
    const { buildRestockData } = await import("./restock-service.js");

    const data = await buildRestockData(machineConfig, "2026-07-10");

    expect(data).toMatchObject({
      batchId: "Towne-2026-07-10",
      event: "Load",
      machine: "Towne",
      date: "2026-07-10",
    });
    expect(data.slots).toHaveLength(35);
    expect(data.slots[0]).toMatchObject({
      slot: 1,
      flavor: "Thai Tea",
      sweetness: "Less Sweet",
      topping: "Lychee",
      size: "16oz",
      previous: 3,
      waste: 3,
      new: 4,
      empty: false,
    });
    expect(data.slots[1]).toMatchObject({
      slot: 2,
      new: 2,
      empty: false,
    });
  });

  it("submits load rows and updates existing Nayax slots", async () => {
    mocks.readSheetValues.mockImplementation(
      async (_spreadsheetId, sheetName) => {
        if (sheetName === "Restock Log") return [restockHeader];
        if (sheetName === "Production Plan") return productionPlan;
        return [];
      },
    );
    mocks.getMachineProducts.mockResolvedValue([
      {
        MachineProductID: 11,
        NayaxProductID: 101,
        MDBCode: 1,
        PAR: 3,
        DEXProductName: "Thai Tea Less Sweet w/ Lychee 16oz",
      },
    ]);
    const { submitRestock } = await import("./restock-service.js");

    await expect(
      submitRestock(
        {
          batchId: "Towne-2026-07-10",
          event: "Load",
          machine: "Towne",
          date: "2026-07-10",
          duration: "5m 32s",
          slots: [{ slot: 1, waste: 3, new: 4 }],
        },
        machineConfig,
      ),
    ).resolves.toEqual({ success: true, message: "Restock complete" });

    expect(mocks.appendSheetRows).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      "Restock Log",
      [
        [
          "Towne-2026-07-10",
          "Clearout",
          "2026-07-10",
          1,
          expect.any(String),
          3,
          3,
          0,
          0,
          0,
        ],
        [
          "Towne-2026-07-10",
          "Load",
          "2026-07-10",
          1,
          expect.any(String),
          3,
          3,
          4,
          4,
          4,
        ],
      ],
    );
    expect(mocks.updateMachineProducts).toHaveBeenCalledWith("machine-1", [
      expect.objectContaining({
        MachineProductID: 11,
        NayaxProductID: 101,
        MachineID: "machine-1",
        MDBCode: 1,
        PAR: 4,
        DEXProductName: "Thai Tea Less Sweet w/ Lychee 16oz",
      }),
    ]);
    expect(mocks.createMachineProducts).toHaveBeenCalledWith("machine-1", []);
    expect(mocks.sendRestockSlack).toHaveBeenCalledWith(expect.any(Object), 2);
  });

  it("reports conflicts for duplicate event submissions", async () => {
    mocks.readSheetValues.mockResolvedValueOnce([
      restockHeader,
      ["Towne-2026-07-10", "Load", "2026-07-10", 1],
    ]);
    const { submitRestock } = await import("./restock-service.js");

    await expect(
      submitRestock(
        {
          batchId: "Towne-2026-07-10",
          event: "Load",
          machine: "Towne",
          date: "2026-07-10",
          slots: [],
        },
        machineConfig,
      ),
    ).resolves.toEqual({
      conflict: true,
      existingEntryUrl: "#gid=0&range=A2:J2",
    });
  });
});
