import {
  assertConfigured,
  getAmountHeader,
  getMachineSlotCount,
  getSlotHeader,
  PRODUCTION_PLAN_SHEET,
  RESTOCK_LOG_SHEET,
  RESTOCK_EVENTS,
  SHEET_IDS,
} from "./config.js";
import { AlreadySubmittedError } from "./errors.js";
import {
  readLatestSheetValues,
  readSheetValues,
  rowsToObjects,
} from "./google-sheets.js";
import {
  getMachineProducts,
  getProductOnHand,
  getProductName,
  getProductPar,
  getProductSlot,
  hasProductOnHand,
} from "./nayax.js";
import {
  canonicalDrinkKey,
  canonicalDrinkKeyFromSlot,
  normalizeDrinkName,
  parseDrinkName,
  slotCapacityForDrink,
  slotCapacityForDrinkParts,
} from "./drinks.js";

function parseInteger(value, fallback = 0) {
  if (value === "" || value === null || typeof value === "undefined")
    return fallback;
  const number = parseInt(value, 10);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function parseSlots(value) {
  return String(value || "")
    .split(/[,\s;]+/)
    .map((slot) => Number(slot.trim()))
    .filter((slot) => Number.isInteger(slot) && slot > 0);
}

function toSlotMap(products) {
  const map = new Map();
  for (const product of products) {
    const slot = getProductSlot(product);
    if (Number.isInteger(slot)) map.set(slot, product);
  }
  return map;
}

function buildDrinkWarning(slot, rawDrink, parsed, current, previous) {
  const par = current ? getProductPar(current) : 0;

  if (!rawDrink && current) {
    return {
      code: "MISSING_NAYAX_PRODUCT_NAME",
      slot,
      previous,
      par,
      returnedFields: Object.keys(current),
      message: `Slot ${slot} is configured in Nayax, but Nayax did not return a product name.`,
    };
  }

  if (rawDrink && (!parsed.flavor || !parsed.size)) {
    return {
      code: "UNPARSED_NAYAX_PRODUCT_NAME",
      slot,
      productName: rawDrink,
      message: `Could not parse Nayax product name for slot ${slot}: ${rawDrink}`,
    };
  }

  if (current && par > 0 && !hasProductOnHand(current)) {
    return {
      code: "MISSING_NAYAX_ON_HAND",
      slot,
      par,
      returnedFields: Object.keys(current),
      message: `Slot ${slot} has PAR ${par}, but Nayax did not return a readable on-hand count.`,
    };
  }

  return null;
}

function makeSlotState(slot, current, event, warnings) {
  const rawDrink = current ? getProductName(current) : "";
  const currentDrink = current ? normalizeDrinkName(rawDrink) : null;
  const parsed = current ? parseDrinkName(currentDrink) : {};
  const previousDrink = currentDrink || null;
  const previous = current ? getProductOnHand(current) : 0;
  const waste = event === RESTOCK_EVENTS.load && current ? previous : 0;
  const warning = current
    ? buildDrinkWarning(slot, rawDrink, parsed, current, previous)
    : null;

  if (warning) {
    warnings.push(warning);
    console.warn("restock-data warning:", warning);
  }

  return {
    slot,
    previousDrink,
    flavor: parsed.flavor || null,
    size: parsed.size || null,
    topping: parsed.topping || null,
    sweetnessLevel: parsed.sweetness || null,
    previous,
    waste,
    expectedNew: 0,
    total: previous - waste,
    unassigned: true,
    hasCurrentProduct: Boolean(current),
  };
}

function updateSlotTotals(slot) {
  slot.total = Math.max(slot.previous - slot.waste + slot.expectedNew, 0);
}

async function buildMachineSlots(machineConfig, event, warnings) {
  const machineProducts = await getMachineProducts(machineConfig.machineId);
  const productBySlot = toSlotMap(machineProducts);
  return Array.from(
    { length: getMachineSlotCount(machineConfig) },
    (_, index) => {
      const slot = index + 1;
      const current = productBySlot.get(slot);
      return makeSlotState(slot, current, event, warnings);
    },
  );
}

function distributeAcrossSlots(total, slots, drink) {
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

function normalizeRequestedMode(mode) {
  const normalized = String(mode || "")
    .trim()
    .toLowerCase();
  return normalized || null;
}

function getPlanVariation(row) {
  return row["Drink Variation"] || row.Variation || row.variation || "";
}

function getInventoryMachineHeader(machineConfig) {
  return `To ${machineConfig.label}`;
}

/** Reads planned drink rows from the Production Plan sheet. */
async function loadProductionPlanRows() {
  const values = await readSheetValues(
    assertConfigured(SHEET_IDS.productionPlan, "PRODUCTION_PLAN_SHEET_ID"),
    PRODUCTION_PLAN_SHEET,
  );
  return rowsToObjects(values).filter((row) =>
    normalizeDrinkName(getPlanVariation(row)),
  );
}

/** Reads existing restock history so the API can choose the next event for a batch. */
async function readRestockLogRows() {
  return rowsToObjects(
    await readSheetValues(
      assertConfigured(SHEET_IDS.restockLog, "RESTOCK_LOG_SHEET_ID"),
      RESTOCK_LOG_SHEET,
    ),
  );
}

/** Reads cold-storage inventory rows for topoff prefill. */
async function readInventoryRows() {
  return rowsToObjects(
    await readLatestSheetValues(
      assertConfigured(SHEET_IDS.inventory, "INVENTORY_SHEET_ID"),
    ),
  ).filter((row) => normalizeDrinkName(row.Drink));
}

function getTopoffCandidates(machineConfig, slots) {
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

function allocateTopoffStorage(storageByDrink, candidates) {
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

export async function determineEvent(batchId, options = {}) {
  const rows = await readRestockLogRows();
  const hasLoad = rows.some(
    (row) =>
      row["Batch ID"] === batchId &&
      String(row.Event).toLowerCase() === RESTOCK_EVENTS.load.toLowerCase(),
  );
  const hasTopoff = rows.some(
    (row) =>
      row["Batch ID"] === batchId &&
      String(row.Event).toLowerCase() === RESTOCK_EVENTS.topoff.toLowerCase(),
  );
  const hasClearout = rows.some(
    (row) =>
      row["Batch ID"] === batchId &&
      String(row.Event).toLowerCase() === RESTOCK_EVENTS.clearout.toLowerCase(),
  );

  const requestedMode = normalizeRequestedMode(options.mode ?? options.event);

  if (
    requestedMode &&
    requestedMode !== RESTOCK_EVENTS.clearout.toLowerCase()
  ) {
    throw new Error(`Invalid mode: ${options.mode ?? options.event}`);
  }

  if (requestedMode === RESTOCK_EVENTS.clearout.toLowerCase()) {
    if (rows.every((row) => row["Batch ID"] !== batchId))
      return RESTOCK_EVENTS.clearout;
    const existing = rows.find((row) => row["Batch ID"] === batchId);
    throw new AlreadySubmittedError(
      "This event has already been submitted for this batch.",
      existing?._rowNumber,
    );
  }

  if (!hasLoad) return RESTOCK_EVENTS.load;
  if (!hasTopoff) return RESTOCK_EVENTS.topoff;

  const existing = rows.find((row) => row["Batch ID"] === batchId);
  throw new AlreadySubmittedError(
    "This event has already been submitted for this batch.",
    existing?._rowNumber,
  );
}

/** Builds the machine slot form payload for the next restock event for a machine/date. */
export async function buildRestockData(machineConfig, date, options = {}) {
  const batchId = `${machineConfig.label}-${date}`;
  const event = await determineEvent(batchId, options);

  const warnings = [];
  const slots = await buildMachineSlots(machineConfig, event, warnings);

  if (event === RESTOCK_EVENTS.load) {
    for (const slot of slots) {
      Object.assign(slot, {
        flavor: null,
        size: null,
        topping: null,
        sweetnessLevel: null,
        unassigned: true,
      });
      updateSlotTotals(slot);
    }

    const rows = await loadProductionPlanRows();
    const amountHeader = getAmountHeader(machineConfig);
    const slotHeader = getSlotHeader(machineConfig);
    for (const row of rows) {
      const drink = normalizeDrinkName(getPlanVariation(row));
      const amount = parseInteger(row[amountHeader]);
      const slotNumbers = parseSlots(row[slotHeader]);
      for (const allocation of distributeAcrossSlots(
        amount,
        slotNumbers,
        drink,
      )) {
        const slot = slots[allocation.slot - 1];
        if (!slot) continue;
        const parsedDrink = parseDrinkName(drink);
        Object.assign(slot, {
          flavor: parsedDrink.flavor || null,
          size: parsedDrink.size || null,
          topping: parsedDrink.topping || null,
          sweetnessLevel: parsedDrink.sweetness || null,
          expectedNew: allocation.quantity,
          unassigned: allocation.quantity === 0,
        });
        updateSlotTotals(slot);
      }
    }
  }

  if (event === RESTOCK_EVENTS.topoff) {
    const inventoryRows = await readInventoryRows();
    const inventoryMachineHeader = getInventoryMachineHeader(machineConfig);
    const storageByDrink = new Map(
      inventoryRows.map((row) => [
        canonicalDrinkKey(row.Drink),
        parseInteger(row[inventoryMachineHeader]),
      ]),
    );
    const candidates = getTopoffCandidates(machineConfig, slots);

    allocateTopoffStorage(storageByDrink, candidates);

    for (const candidate of candidates) {
      candidate.slot.expectedNew = candidate.allocation;
      candidate.slot.unassigned = candidate.allocation === 0;
      updateSlotTotals(candidate.slot);
    }
  }

  if (event === RESTOCK_EVENTS.clearout) {
    for (const slot of slots) {
      if (!slot.hasCurrentProduct) continue;
      slot.expectedNew = 0;
      slot.waste = slot.previous;
      slot.unassigned = false;
      updateSlotTotals(slot);
    }
  }

  for (const slot of slots) {
    delete slot.hasCurrentProduct;
  }

  return {
    batchId,
    event,
    machine: machineConfig.label,
    date,
    slots,
    warnings,
  };
}
