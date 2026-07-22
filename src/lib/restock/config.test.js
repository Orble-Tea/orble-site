import { afterEach, describe, expect, it, vi } from "vitest";

async function importConfig() {
  vi.resetModules();
  return import("./config.js");
}

describe("restock config", () => {
  afterEach(() => {
    delete process.env.NAYAX_MACHINE_TOWNE_ID;
    delete process.env.NAYAX_MACHINE_30TH_ID;
    delete process.env.RESTOCK_MOCK;
    delete process.env.RESTOCK_SECRET_KEY;
  });

  it("resolves machines by key or label", async () => {
    process.env.NAYAX_MACHINE_TOWNE_ID = "towne-machine";
    process.env.NAYAX_MACHINE_30TH_ID = "30th-machine";
    const { getMachineConfig } = await importConfig();

    expect(getMachineConfig("towne")).toMatchObject({
      label: "Towne",
      machineId: "towne-machine",
      amountHeader: "Amount to Towne",
      slotHeader: "Slot (Towne)",
    });
    expect(getMachineConfig("30th")).toMatchObject({
      label: "30th",
      machineId: "30th-machine",
    });
    expect(getMachineConfig("Towne")).toMatchObject({ key: "towne" });
  });

  it("returns undefined for unknown machine names", async () => {
    const { getMachineConfig } = await importConfig();
    expect(getMachineConfig("campus")).toBeUndefined();
  });

  it("detects mock mode and validates secret keys", async () => {
    process.env.RESTOCK_MOCK = "true";
    process.env.RESTOCK_SECRET_KEY = "secret";
    const { isMockMode, requireSecretKey } = await importConfig();

    expect(isMockMode()).toBe(true);
    expect(requireSecretKey("secret")).toBe(true);
    expect(requireSecretKey("wrong")).toBe(false);
  });
});
