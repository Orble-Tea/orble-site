import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createMachineProducts,
  getMachineProducts,
  getMachineProductId,
  getNayaxProductId,
  getProductName,
  getProductOnHand,
  getProductPar,
  getProductSlot,
  hasProductOnHand,
  updateMachineProducts,
} from "../../../src/lib/restock/nayax.js";

describe("nayax helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("requests machine products with bearer auth", async () => {
    vi.stubEnv("NAYAX_API_TOKEN", "token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ MDBCode: 1, MissingStockByMDB: 3, PAR: 4 }],
        }),
        {
          status: 200,
        },
      ),
    );

    await expect(getMachineProducts("machine-1")).resolves.toEqual([
      { MDBCode: 1, MissingStockByMDB: 3, PAR: 4 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://lynx.nayax.com/operational/v1/machines/machine-1/machineProducts",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
      }),
    );
  });

  it("normalizes supported Nayax response and product field shapes", async () => {
    vi.stubEnv("NAYAX_API_TOKEN", "token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [{ mdbCode: "2", MissingStockByMDB: "2", par: "3" }],
        }),
        {
          status: 200,
        },
      ),
    );

    const products = await getMachineProducts("machine-1");
    expect(getProductSlot(products[0])).toBe(2);
    expect(getProductOnHand(products[0])).toBe(1);
    expect(getProductPar(products[0])).toBe(3);
    expect(hasProductOnHand(products[0])).toBe(true);
    expect(getProductName({ dexProductName: " Thai Tea " })).toBe("Thai Tea");
    expect(getMachineProductId({ machineProductId: "mp-1" })).toBe("mp-1");
    expect(getNayaxProductId({ productId: "np-1" })).toBe("np-1");
  });

  it("updates and creates machine products with bearer auth", async () => {
    vi.stubEnv("NAYAX_API_TOKEN", "token");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    const payload = [
      { MachineProductID: "mp-1", NayaxProductID: "np-1", MDBCode: 1, PAR: 4 },
    ];

    await updateMachineProducts("machine-1", payload);
    await createMachineProducts("machine-1", payload);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://lynx.nayax.com/operational/v1/machines/machine-1/machineProducts?avoidDelete=true",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://lynx.nayax.com/operational/v1/machines/machine-1/machineProducts",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
  });

  it("reads portal-style pick fields", () => {
    const product = {
      "Pick Number": "5",
      PAR: "4",
      MissingStockByMDB: "1",
    };

    expect(getProductSlot(product)).toBe(5);
    expect(getProductOnHand(product)).toBe(3);
    expect(getProductPar(product)).toBe(4);
    expect(hasProductOnHand(product)).toBe(true);
  });

  it("derives on-hand from PAR minus Nayax missing stock fields", () => {
    expect(getProductOnHand({ PAR: 4, MissingStockByMDB: 1 })).toBe(3);
    expect(getProductOnHand({ PAR: 4, MissingStockByDEX: 4 })).toBe(0);
    expect(hasProductOnHand({ PAR: 4, MissingStockByMDB: 1 })).toBe(true);
  });

  it("does not treat PAR as on-hand inventory", () => {
    expect(getProductOnHand({ PAR: 4 })).toBe(0);
    expect(hasProductOnHand({ PAR: 4 })).toBe(false);
  });

  it("throws on missing tokens", async () => {
    await expect(getMachineProducts("machine-1")).rejects.toThrow(
      "NAYAX_API_TOKEN",
    );
  });

  it("throws a clear error for invalid Nayax tokens", async () => {
    vi.stubEnv("NAYAX_API_TOKEN", "token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );

    await expect(getMachineProducts("machine-1")).rejects.toMatchObject({
      message: "Invalid NAYAX_API_TOKEN",
      upstream: true,
      details: {
        service: "nayax",
        operation: "get_machine_products",
        status: 401,
      },
    });
  });

  it("throws a clear error for unauthorized Nayax tokens", async () => {
    vi.stubEnv("NAYAX_API_TOKEN", "token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Forbidden", { status: 403 }),
    );

    await expect(getMachineProducts("machine-1")).rejects.toMatchObject({
      message: "NAYAX_API_TOKEN is not authorized",
      upstream: true,
      details: {
        service: "nayax",
        operation: "get_machine_products",
        status: 403,
      },
    });
  });

  it("marks other Nayax failures as upstream errors", async () => {
    vi.stubEnv("NAYAX_API_TOKEN", "token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Server error", { status: 500 }),
    );

    await expect(getMachineProducts("machine-1")).rejects.toMatchObject({
      message: "Nayax request failed with status 500",
      upstream: true,
      details: {
        service: "nayax",
        operation: "get_machine_products",
        status: 500,
      },
    });
  });
});
