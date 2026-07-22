import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function importNayax() {
  vi.resetModules();
  process.env.NAYAX_API_TOKEN = "token";
  process.env.NAYAX_BASE_URL = "https://lynx.test/operational/v1";
  return import("./nayax.js");
}

describe("Nayax client", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.NAYAX_API_TOKEN;
    delete process.env.NAYAX_BASE_URL;
  });

  it("fetches machine products with bearer auth", async () => {
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ MDBCode: 1, PAR: 4 }] }), {
        status: 200,
      }),
    );
    const { getMachineProducts } = await importNayax();

    await expect(getMachineProducts("machine-1")).resolves.toEqual([
      { MDBCode: 1, PAR: 4 },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "https://lynx.test/operational/v1/machines/machine-1/machineProducts",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("updates machine products without deleting omitted slots", async () => {
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const { updateMachineProducts } = await importNayax();
    const products = [{ MachineProductID: 11, MDBCode: 1, PAR: 4 }];

    await updateMachineProducts("machine-1", products);

    expect(fetch).toHaveBeenCalledWith(
      "https://lynx.test/operational/v1/machines/machine-1/machineProducts?avoidDelete=true",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify(products),
      }),
    );
  });

  it("skips create calls when there are no new products", async () => {
    const { createMachineProducts } = await importNayax();

    await expect(createMachineProducts("machine-1", [])).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("creates new machine products when assigning empty slots", async () => {
    fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { createMachineProducts } = await importNayax();
    const products = [{ NayaxProductID: 101, MDBCode: 7, PAR: 4 }];

    await expect(
      createMachineProducts("machine-1", products),
    ).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      "https://lynx.test/operational/v1/machines/machine-1/machineProducts",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(products),
      }),
    );
  });

  it("normalizes Nayax product field names", async () => {
    const {
      getMachineProductId,
      getNayaxProductId,
      getProductName,
      getProductPar,
      getProductSlot,
    } = await importNayax();

    expect(getProductSlot({ mdbCode: "7" })).toBe(7);
    expect(getProductPar({ par: "3" })).toBe(3);
    expect(getProductName({ dexProductName: " Thai Tea " })).toBe("Thai Tea");
    expect(getMachineProductId({ machineProductId: 12 })).toBe(12);
    expect(getNayaxProductId({ nayaxProductId: 99 })).toBe(99);
  });

  it("surfaces Nayax error responses", async () => {
    fetch.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));
    const { getMachineProducts } = await importNayax();

    await expect(getMachineProducts("machine-1")).rejects.toThrow(
      "Nayax request failed: Forbidden",
    );
  });
});
