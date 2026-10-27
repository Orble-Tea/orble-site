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
  normalizeDrinkName,
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

/**
 * Hands cups out one at a time to the slot with the fewest. A level tie goes
 * to the slot that started emptier, then list order. Stops when every slot is
 * full, so the rest stays where it was.
 * @param {number} cups to hand out
 * @param {{ start: number, capacity: number }[]} slots cups in each now, and its cap
 * @returns {number[]} cups added to each slot, same order as `slots`
 */
export function distributeDrinkAcrossSlots(cups, slots) {
  const added = slots.map(() => 0);
  let remaining = cups;
  while (remaining > 0) {
    let lowest = -1;
    slots.forEach((slot, index) => {
      const level = slot.start + added[index];
      if (level >= slot.capacity) return;
      if (lowest === -1) {
        lowest = index;
        return;
      }
      const lowestLevel = slots[lowest].start + added[lowest];
      if (
        level < lowestLevel ||
        (level === lowestLevel &&
          slot.capacity - slot.start >
            slots[lowest].capacity - slots[lowest].start)
      ) {
        lowest = index;
      }
    });
    if (lowest === -1) break;
    added[lowest] += 1;
    remaining -= 1;
  }
  return added;
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

/**
 * @typedef {object} Candidate a slot that can take cups
 * @property {string} machineLabel
 * @property {object} slot the slot state from makeSlotState
 * @property {string} drinkKey the drink held, "" for an empty slot
 * @property {number} capacityLeft cups that still fit
 * @property {number} allocation cups given to it so far
 */

/**
 * One candidate per slot: a filled slot with room keeps its drink key, an empty
 * slot gets "". A full slot or one with an unreadable drink is left out.
 * @param {{ label: string }} machineConfig
 * @param {object[]} slots slot states from makeSlotState
 * @returns {Candidate[]}
 */
export function getTopoffCandidates(machineConfig, slots) {
  return slots.flatMap((slot) => {
    const empty = !slot.hasCurrentProduct;
    const drinkKey = empty ? "" : canonicalDrinkKeyFromSlot(slot);
    const capacityLeft = Math.max(
      (empty ? DEFAULT_DRINK_SLOT_CAPACITY : slotCapacityForDrinkParts(slot)) -
        slot.previous,
      0,
    );
    if (!empty && (!drinkKey || capacityLeft === 0)) return [];
    return [
      {
        machineLabel: machineConfig.label,
        slot,
        drinkKey,
        capacityLeft,
        allocation: 0,
      },
    ];
  });
}

/**
 * Spreads each drink's storage over its candidate slots, one cup at a time to the
 * slot with the fewest. When every slot holding the drink is full and at least
 * half a slot remains, the next empty slot on a machine that already holds the
 * drink takes it. The candidate slots are not changed.
 * @param {Map<string, number>} storageByDrink drink key -> cups in storage
 * @param {Candidate[]} candidateSlots from getTopoffCandidates, one machine or both
 * @returns {{ machineLabel: string, slotNumber: number, drinkKey: string, allocation: number }[]} one entry per slot that gets cups
 */
export function fillSlotsAcrossMachinesFromStorage(
  storageByDrink,
  candidateSlots,
) {
  // Sorted by machine and number with all 30th slots low to high, then all
  // Towne slots low to high, so the first empty slot found is the lowest 30th.
  const working = candidateSlots
    .map((candidate) => ({ ...candidate }))
    .sort(
      (left, right) =>
        left.machineLabel.localeCompare(right.machineLabel) ||
        left.slot.slotNumber - right.slot.slotNumber,
    );

  for (const [drinkKey, storage] of storageByDrink) {
    let remaining = storage;
    while (remaining > 0) {
      const held = working.filter(
        (candidate) => candidate.drinkKey === drinkKey,
      );
      if (held.length === 0) break;

      const added = distributeDrinkAcrossSlots(
        remaining,
        held.map((candidate) => ({
          start: candidate.slot.previous + candidate.allocation,
          capacity: candidate.slot.previous + candidate.capacityLeft,
        })),
      );
      held.forEach((candidate, index) => {
        candidate.allocation += added[index];
      });
      remaining -= added.reduce((sum, count) => sum + count, 0);

      // An empty slot is only worth opening if it ends up at least half full,
      // and only on a machine that already sells the drink.
      if (remaining < DEFAULT_DRINK_SLOT_CAPACITY / 2) break;
      const empty = working.find(
        (candidate) =>
          !candidate.drinkKey &&
          held.some((h) => h.machineLabel === candidate.machineLabel),
      );
      if (!empty) break;
      empty.drinkKey = drinkKey;
    }
  }

  return working
    .filter((candidate) => candidate.allocation > 0)
    .map((candidate) => ({
      machineLabel: candidate.machineLabel,
      slotNumber: candidate.slot.slotNumber,
      drinkKey: candidate.drinkKey,
      allocation: candidate.allocation,
    }));
}
