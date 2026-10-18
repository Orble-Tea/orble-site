// Reads of the Production Plan, Inventory and Restock Log sheets, and the
// Topoff allocation of cold storage across slots. Pure except the three reads.
import {
  assertConfigured,
  PRODUCTION_PLAN_SHEET,
  RESTOCK_EVENTS,
  RESTOCK_LOG_HEADER,
  RESTOCK_LOG_SHEET,
  SHEET_IDS,
} from "./config.js";
import { ERRORS, UpstreamServiceError } from "./errors.js";
import {
  readLatestSheetValues,
  readSheetValues,
  rowsToObjects,
} from "./google-sheets.js";
import {
  canonicalDrinkKeyFromSlot,
  normalizeDrinkName,
  slotCapacityForDrink,
  slotCapacityForDrinkParts,
} from "./drinks.js";

const { BATCH_ID, EVENT } = RESTOCK_LOG_HEADER;

export function parseInteger(value, fallback = 0) {
  if (value === "" || value === null || typeof value === "undefined")
    return fallback;
  const number = parseInt(value, 10);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

export function parseSlots(value) {
  return String(value || "")
    .split(/[,\s;]+/)
    .map((slot) => Number(slot.trim()))
    .filter((slot) => Number.isInteger(slot) && slot > 0);
}

function normalizeColumnName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function findColumnName(row, expectedColumnName) {
  const expected = normalizeColumnName(expectedColumnName);
  return Object.keys(row).find(
    (columnName) => normalizeColumnName(columnName) === expected,
  );
}

export function getRowValue(row, expectedColumnName) {
  const columnName = findColumnName(row, expectedColumnName);
  return columnName ? row[columnName] : "";
}

export function distributeAcrossSlots(total, slots, drink) {
  const capacity = slotCapacityForDrink(drink);
  let remaining = total;
  const allocations = slots.map((slot) => ({ slot, quantity: 0 }));

  while (
    remaining > 0 &&
    allocations.some((allocation) => allocation.quantity < capacity)
  ) {
    for (const allocation of allocations) {
      if (remaining <= 0) break;
      if (allocation.quantity >= capacity) continue;
      allocation.quantity += 1;
      remaining -= 1;
    }
  }

  return allocations;
}

export function getPlanVariation(row) {
  return getRowValue(row, "Drink Variation") || getRowValue(row, "Variation");
}

export function getInventoryMachineHeader(machineConfig) {
  return `To ${machineConfig.label}`;
}

/** Reads planned drink rows from the Production Plan sheet. */
export async function loadProductionPlanRows() {
  const values = await readSheetValues(
    assertConfigured(SHEET_IDS.productionPlan, "PRODUCTION_PLAN_SHEET_ID"),
    PRODUCTION_PLAN_SHEET,
  );
  return rowsToObjects(values).filter((row) =>
    normalizeDrinkName(getPlanVariation(row)),
  );
}

/**
 * The Restock Log: its header row, for writes in the sheet's own column order,
 * and every row as an object with Event in canonical case and Batch ID
 * trimmed, so every later compare is exact. A hand-edited cell is normalized
 * here once instead of lower-cased at each compare.
 * @returns {Promise<{ header: unknown[], rows: import("./restock-log.js").LogRow[] }>}
 */
export async function readRestockLog() {
  const values = await readSheetValues(
    assertConfigured(SHEET_IDS.restockLog, "RESTOCK_LOG_SHEET_ID"),
    RESTOCK_LOG_SHEET,
  );
  if (!values?.length)
    throw new UpstreamServiceError(ERRORS.logHeaderMissing.message, {
      service: "google_sheets",
      operation: "read_restock_log",
    });
  const eventByLower = new Map(
    Object.values(RESTOCK_EVENTS).map((event) => [event.toLowerCase(), event]),
  );
  const rows = rowsToObjects(values).map((row) => {
    const event = String(row[EVENT] ?? "").trim();
    return {
      ...row,
      [EVENT]: eventByLower.get(event.toLowerCase()) ?? event,
      [BATCH_ID]: String(row[BATCH_ID] ?? "").trim(),
    };
  });
  return { header: values[0] || [], rows };
}

/** Reads cold-storage inventory rows for topoff prefill. */
export async function readInventoryRows() {
  return rowsToObjects(
    await readLatestSheetValues(
      assertConfigured(SHEET_IDS.inventory, "INVENTORY_SHEET_ID"),
    ),
  ).filter((row) => normalizeDrinkName(getRowValue(row, "Drink")));
}

export function getTopoffCandidates(machineConfig, slots) {
  return slots
    .filter((slot) => slot.hasCurrentProduct)
    .map((slot) => {
      const capacity = slotCapacityForDrinkParts(slot);
      return {
        machineLabel: machineConfig.label,
        slot,
        drinkKey: canonicalDrinkKeyFromSlot(slot),
        capacityLeft: Math.max(capacity - slot.previous, 0),
        allocation: 0,
      };
    })
    .filter((candidate) => candidate.drinkKey && candidate.capacityLeft > 0);
}

export function allocateTopoffStorage(storageByDrink, candidates) {
  const candidatesByDrink = new Map();
  for (const candidate of candidates) {
    if (!candidatesByDrink.has(candidate.drinkKey)) {
      candidatesByDrink.set(candidate.drinkKey, []);
    }
    candidatesByDrink.get(candidate.drinkKey).push(candidate);
  }

  for (const [drinkKey, drinkCandidates] of candidatesByDrink) {
    let remaining = storageByDrink.get(drinkKey) || 0;
    while (remaining > 0) {
      const openCandidates = drinkCandidates.filter(
        (candidate) => candidate.allocation < candidate.capacityLeft,
      );
      if (openCandidates.length === 0) break;

      openCandidates.sort((left, right) => {
        const leftTotal = left.slot.previous + left.allocation;
        const rightTotal = right.slot.previous + right.allocation;
        return (
          leftTotal - rightTotal ||
          right.capacityLeft - left.capacityLeft ||
          left.machineLabel.localeCompare(right.machineLabel) ||
          left.slot.slot - right.slot.slot
        );
      });

      openCandidates[0].allocation += 1;
      remaining -= 1;
    }
  }
}
