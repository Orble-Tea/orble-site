export const SHEET_IDS = {
  productionPlan: process.env.PRODUCTION_PLAN_SHEET_ID,
  inventory: process.env.INVENTORY_SHEET_ID,
  restockLog: process.env.RESTOCK_LOG_SHEET_ID,
};

export const MACHINE_CONFIG = [
  {
    label: "30th",
    machineId: process.env.NAYAX_MACHINE_30TH_ID,
    rows: 7,
    columns: 5,
  },
  {
    label: "Towne",
    machineId: process.env.NAYAX_MACHINE_TOWNE_ID,
    rows: 7,
    columns: 5,
  },
];

export const RESTOCK_LOG_SHEET = "Restock Log";
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

/**
 * The slot numbers the app manages on a machine. RESTOCK_SLOTS_<LABEL>
 * (comma-separated) overrides the rows*columns default; the live submit
 * test uses it to reach a slot above 35. Read per call so tests can stub it.
 */
export function getMachineSlots(machineConfig) {
  const override =
    process.env[`RESTOCK_SLOTS_${machineConfig.label.toUpperCase()}`];
  if (override) {
    return override
      .split(",")
      .map((slot) => Number(slot.trim()))
      .filter((slot) => Number.isInteger(slot) && slot > 0);
  }
  return Array.from(
    { length: getMachineSlotCount(machineConfig) },
    (_, index) => index + 1,
  );
}

export function assertConfigured(value, name) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
