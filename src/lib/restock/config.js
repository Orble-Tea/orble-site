export const SHEET_IDS = {
  productionPlan:
    process.env.PRODUCTION_PLAN_SHEET_ID ||
    "1q9D_qlRPiltdm4hXHDFvgjQ4JQldTh3JlItZVif8OBA",
  inventory:
    process.env.INVENTORY_SHEET_ID ||
    "1pxJM0-0ZCW8HhXjh4pxwbMKb5OI4nZMycZjiUTAUcdo",
  restockLog:
    process.env.RESTOCK_LOG_SHEET_ID ||
    "1snMwpOUhOS_DgSOh424hZXlI2fAzDsKy25ngoxORkDw",
};

export const MACHINE_CONFIG = [
  {
    key: "towne",
    label: "Towne",
    machineId: process.env.NAYAX_MACHINE_TOWNE_ID,
    amountHeader: "Amount to Towne",
    slotHeader: "Slot (Towne)",
  },
  {
    key: "30th",
    label: "30th",
    machineId: process.env.NAYAX_MACHINE_30TH_ID,
    amountHeader: "Amount to 30th",
    slotHeader: "Slot (30th)",
  },
];

export const RESTOCK_LOG_SHEET = process.env.RESTOCK_LOG_SHEET || "Restock Log";
export const VISITS_SHEET = process.env.VISITS_SHEET || "Visits";
export const PRODUCTION_PLAN_SHEET =
  process.env.PRODUCTION_PLAN_SHEET || "Production Plan";

export const NAYAX_BASE_URL =
  process.env.NAYAX_BASE_URL || "https://qa-lynx.nayax.com/operational/v1";

export function isMockMode() {
  return process.env.RESTOCK_MOCK === "1" || process.env.RESTOCK_MOCK === "true";
}

export function requireSecretKey(key) {
  return Boolean(process.env.RESTOCK_SECRET_KEY && key === process.env.RESTOCK_SECRET_KEY);
}

export function getMachineConfig(machine) {
  const normalized = String(machine || "").trim().toLowerCase();
  return MACHINE_CONFIG.find(
    (candidate) =>
      candidate.key.toLowerCase() === normalized ||
      candidate.label.toLowerCase() === normalized,
  );
}

export function assertConfigured(value, name) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
