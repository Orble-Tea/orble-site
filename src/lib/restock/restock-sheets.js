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
import { ERRORS, RestockError, UpstreamServiceError } from "./errors.js";
import {
  findSheetNameForDate,
  readSheetValues,
  rowsToObjects,
} from "./google-sheets.js";
import {
  canonicalDrinkKeyFromSlot,
  DEFAULT_DRINK_SLOT_CAPACITY,
  EMPTY_SLOT_MIN_FILL,
  normalizeDrinkName,
  slotCapacityForDrink,
  slotCapacityForDrinkParts,
} from "./drink-parsing.js";

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

/**
 * Cold-storage inventory rows for a Topoff, from the tab named for the batch
 * date.
 * @param {string} date YYYY-MM-DD
 * @throws {RestockError} 409 noInventoryForBatch when the workbook has no tab for that date
 */
export async function readInventoryRows(date) {
  const inventoryId = assertConfigured(
    SHEET_IDS.inventory,
    "INVENTORY_SHEET_ID",
  );
  const sheetName = await findSheetNameForDate(inventoryId, date);
  if (!sheetName) throw new RestockError(ERRORS.noInventoryForBatch(date));
  return rowsToObjects(await readSheetValues(inventoryId, sheetName)).filter(
    (row) => normalizeDrinkName(getRowValue(row, "Drink")),
  );
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

export function emptySlotCandidate(machineLabel, slot) {
  return {
    machineLabel,
    slot: { slot, previous: 0 },
    drinkKey: "",
    capacityLeft: DEFAULT_DRINK_SLOT_CAPACITY,
    allocation: 0,
  };
}

function compareCandidates(left, right) {
  return (
    left.machineLabel.localeCompare(right.machineLabel) ||
    left.slot.slot - right.slot.slot
  );
}

// One can at a time to the slot with the fewest; when every slot holding the
// drink is full and EMPTY_SLOT_MIN_FILL or more remain, the next empty slot takes it.
export function allocateTopoffStorage(
  storageByDrink,
  candidates,
  emptySlots = [],
) {
  const candidatesByDrink = new Map();
  for (const candidate of candidates) {
    if (!candidatesByDrink.has(candidate.drinkKey)) {
      candidatesByDrink.set(candidate.drinkKey, []);
    }
    candidatesByDrink.get(candidate.drinkKey).push(candidate);
  }
  const unclaimed = [...emptySlots].sort(compareCandidates);

  for (const [drinkKey, drinkCandidates] of candidatesByDrink) {
    let remaining = storageByDrink.get(drinkKey) || 0;
    while (remaining > 0) {
      let openCandidates = drinkCandidates.filter(
        (candidate) => candidate.allocation < candidate.capacityLeft,
      );
      if (openCandidates.length === 0) {
        if (remaining < EMPTY_SLOT_MIN_FILL || unclaimed.length === 0) break;
        const taken = unclaimed.shift();
        taken.drinkKey = drinkKey;
        drinkCandidates.push(taken);
        openCandidates = [taken];
      }

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
