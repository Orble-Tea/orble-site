import process from "node:process";
import { PLAN_MACHINES } from "../production-plan.js";

export const SHEET_IDS = {
  productionPlan: process.env.PRODUCTION_PLAN_SHEET_ID,
  inventory: process.env.INVENTORY_SHEET_ID,
  restockLog: process.env.RESTOCK_LOG_SHEET_ID,
};

export const MACHINE_CONFIG = PLAN_MACHINES.map((machine) => ({
  ...machine,
  machineId: process.env[`NAYAX_MACHINE_${machine.label.toUpperCase()}_ID`],
}));

export const RESTOCK_LOG_SHEET = "Restock Log";
export const VISITS_SHEET = "Visits";
export const PRODUCTION_PLAN_SHEET = "Production Plan";
export const INVENTORY_SHEET = "Inventory";

export const NAYAX_BASE_URL =
  process.env.NAYAX_BASE_URL || "https://lynx.nayax.com/operational/v1";

export const RESTOCK_EVENTS = {
  load: "Load",
  topoff: "Topoff",
  clearout: "Clearout",
};

export function requireRestockSecretKey(key) {
  return Boolean(
    process.env.RESTOCK_SECRET_KEY && key === process.env.RESTOCK_SECRET_KEY,
  );
}

export function getMachineConfig(machine) {
  const normalized = String(machine || "")
    .trim()
    .toLowerCase();
  return MACHINE_CONFIG.find(
    (candidate) => candidate.label.toLowerCase() === normalized,
  );
}

export function getAmountHeader(machineConfig) {
  return `Amount to ${machineConfig.label}`;
}

export function getSlotHeader(machineConfig) {
  return `Slot (${machineConfig.label})`;
}

export function getMachineSlotCount(machineConfig) {
  return machineConfig.rows * machineConfig.columns;
}

export function assertConfigured(value, name) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
