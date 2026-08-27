import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertConfigured,
  getAmountHeader,
  getMachineConfig,
  getMachineSlotCount,
  getSlotHeader,
  NAYAX_BASE_URL,
  requireRestockSecretKey,
  RESTOCK_EVENTS,
} from "../../../src/lib/restock/config.js";

describe("restock config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("validates the shared route secret", () => {
    vi.stubEnv("RESTOCK_SECRET_KEY", "secret");

    expect(requireRestockSecretKey("secret")).toBe(true);
    expect(requireRestockSecretKey("bad")).toBe(false);
  });

  it("finds machines by label", () => {
    expect(getMachineConfig("30th")?.label).toBe("30TH");
    expect(getMachineConfig("missing")).toBeUndefined();
  });

  it("derives spreadsheet headers and slot count from machine config", () => {
    const machine = getMachineConfig("30th");

    expect(getAmountHeader(machine)).toBe("Amount to 30TH");
    expect(getSlotHeader(machine)).toBe("Slot (30TH)");
    expect(getMachineSlotCount(machine)).toBe(35);
  });

  it("keeps event names and production Nayax URL in config", () => {
    expect(RESTOCK_EVENTS).toEqual({
      load: "Load",
      topoff: "Topoff",
      clearout: "Clearout",
    });
    expect(NAYAX_BASE_URL).toBe("https://lynx.nayax.com/operational/v1");
  });

  it("checks required configuration", () => {
    expect(assertConfigured("value", "TEST_VALUE")).toBe("value");
    expect(() => assertConfigured("", "TEST_VALUE")).toThrow(
      "Missing required environment variable: TEST_VALUE",
    );
  });
});
