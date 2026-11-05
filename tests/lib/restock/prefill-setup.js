// Fresh config and prefill modules per test, with the env every GET needs.
// Callers restore mocks and envs in their own afterEach.
import { vi } from "vitest";

export async function loadPrefill() {
  vi.resetModules();
  vi.stubEnv("GOOGLE_SHEETS_ACCESS_TOKEN", "sheets-token");
  vi.stubEnv("NAYAX_API_TOKEN", "nayax-token");
  vi.stubEnv("NAYAX_MACHINE_30TH_ID", "machine-1");
  vi.stubEnv("PRODUCTION_PLAN_SHEET_ID", "production-plan-sheet");
  vi.stubEnv("INVENTORY_SHEET_ID", "inventory-sheet");
  vi.stubEnv("RESTOCK_LOG_SHEET_ID", "restock-log-sheet");
  const { getMachineConfig } =
    await import("../../../src/lib/restock/config.js");
  const { buildRestockData } =
    await import("../../../src/lib/restock/restock-prefill.js");
  return { buildRestockData, getMachineConfig };
}
