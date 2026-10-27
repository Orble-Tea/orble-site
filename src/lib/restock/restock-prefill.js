// The GET prefill: which event the batch takes next and the slot form for it,
// built from the machine's Nayax products and the plan or Inventory sheet.
import {
  getAmountHeader,
  getMachineSlots,
  getSlotHeader,
  KITCHEN_LABEL,
  MACHINE_CONFIG,
  RESTOCK_EVENTS,
  RESTOCK_LOG_HEADER,
} from "./config.js";
import { ERRORS, RestockError, WARNINGS, inventoryTabName } from "./errors.js";
import {
  batchRuleViolation,
  getBatchLogRows,
  lastMachineBatchEvent,
  SUBMIT_STATUS,
} from "./restock-log.js";
import {
  fillSlotsAcrossMachinesFromStorage,
  distributeDrinkAcrossSlots,
  findColumnName,
  getInventoryMachineHeader,
  getPlanVariation,
  getRowValue,
  getTopoffCandidates,
  loadProductionPlanRows,
  parseInteger,
  parseSlots,
  readInventoryRows,
  readRestockLog,
} from "./restock-sheets.js";
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
  describeInvalidDrink,
  isValidDrink,
  normalizeDrinkName,
  parseDrinkName,
  slotCapacityForDrink,
} from "./drink-parsing.js";
import { totalAfter } from "./slot-validation-rules.js";

function addWarning(warnings, warning) {
  warnings.push(warning);
  console.warn("restock-data warning:", warning);
}

/**
 * Refuses the GET when a sheet row with an amount for this machine names a
 * drink the parser cannot read. The same check for the Production Plan on a
 * Load and the Inventory tab on a Topoff.
 */
function assertReadableDrinks(
  sheetName,
  machineLabel,
  rows,
  drinkOf,
  hasAmount,
) {
  const invalid = rows
    .filter(hasAmount)
    .map((row) => {
      const name = normalizeDrinkName(drinkOf(row));
      return { name, reason: describeInvalidDrink(parseDrinkName(name)) };
    })
    .filter((row) => row.reason);
  if (invalid.length === 0) return;
  throw new RestockError(
    ERRORS.sheetDrinksInvalid(sheetName, machineLabel, invalid),
    { sheet: sheetName, machine: machineLabel, invalidDrinks: invalid },
  );
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
      message: WARNINGS.missingNayaxProductName(slot),
    };
  }

  if (rawDrink && !isValidDrink(parsed)) {
    const reason = describeInvalidDrink(parsed);
    return {
      code: "UNPARSED_NAYAX_PRODUCT_NAME",
      slot,
      productName: rawDrink,
      reason,
      message: WARNINGS.unparsedNayaxProductName(slot, rawDrink, reason),
    };
  }

  if (current && par > 0 && !hasProductOnHand(current)) {
    return {
      code: "MISSING_NAYAX_ON_HAND",
      slot,
      par,
      returnedFields: Object.keys(current),
      message: WARNINGS.missingNayaxOnHand(slot, par),
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
  const waste = event === RESTOCK_EVENTS.LOAD && current ? previous : 0;
  const warning = current
    ? buildDrinkWarning(slot, rawDrink, parsed, current, previous)
    : null;

  if (warning) {
    addWarning(warnings, warning);
  }

  return {
    slotNumber: slot,
    previousDrink,
    flavor: parsed.flavor || null,
    size: parsed.size || null,
    topping: parsed.topping || null,
    sweetness: parsed.sweetness || null,
    previous,
    waste,
    expectedNew: 0,
    total: totalAfter(previous, waste, 0),
    hasCurrentProduct: Boolean(current),
  };
}

function buildMachineSlots(machineProducts, machineConfig, event, warnings) {
  const productBySlot = new Map(
    machineProducts.map((p) => [getProductSlot(p), p]),
  );
  return getMachineSlots(machineConfig).map((slot) =>
    makeSlotState(slot, productBySlot.get(slot), event, warnings),
  );
}

function normalizeRequestedMode(mode) {
  const normalized = String(mode || "")
    .trim()
    .toLowerCase();
  return normalized || null;
}

/** A stored submit as the form's prefill, so pressing Complete resends it. */
function prefillFromLogRow(batchId, row) {
  const slots = JSON.parse(row[RESTOCK_LOG_HEADER.SLOT_DATA] || "[]").map(
    (entry) => {
      const parsed = entry.Drink
        ? parseDrinkName(normalizeDrinkName(entry.Drink))
        : {};
      return {
        slotNumber: entry.Slot,
        previousDrink: entry["Previous Drink"] ?? null,
        flavor: parsed.flavor || null,
        size: parsed.size || null,
        topping: parsed.topping || null,
        sweetness: parsed.sweetness || null,
        previous: entry.Previous,
        waste: entry.Waste,
        expectedNew: entry.New,
        total: entry.Total,
      };
    },
  );
  return {
    batchId,
    event: row[RESTOCK_LOG_HEADER.EVENT],
    slots,
    warnings: [],
  };
}

/**
 * The kitchen's split of fridge storage between both machines, decided from
 * what every slot holds now.
 * @param {string} date YYYY-MM-DD
 * @returns {Promise<{ batchId: string, event: string, drinks: { drink: string, storage: number, to30th: number, toTowne: number }[], warnings: object[] }>}
 */
async function buildSplitData(date) {
  const warnings = [];
  const [inventoryRows, ...productsByMachine] = await Promise.all([
    readInventoryRows(date),
    ...MACHINE_CONFIG.map((config) => getMachineProducts(config.machineId)),
  ]);
  assertReadableDrinks(
    `Inventory tab ${inventoryTabName(date)}`,
    KITCHEN_LABEL,
    inventoryRows,
    (row) => getRowValue(row, "Drink"),
    (row) => parseInteger(getRowValue(row, "Storage")) > 0,
  );

  // A slot whose product nobody can read is planned as empty: the restocker
  // sorts it out on the Topoff, the kitchen only needs to know it has room.
  const candidateSlots = MACHINE_CONFIG.flatMap((config, index) =>
    getTopoffCandidates(
      config,
      buildMachineSlots(
        productsByMachine[index],
        config,
        RESTOCK_EVENTS.SPLIT,
        warnings,
      ).map((slot) =>
        slot.hasCurrentProduct && !canonicalDrinkKeyFromSlot(slot)
          ? { ...slot, hasCurrentProduct: false, previous: 0 }
          : slot,
      ),
    ),
  );
  const parsedRows = inventoryRows.map((row) => ({
    drink: normalizeDrinkName(getRowValue(row, "Drink")),
    drinkKey: canonicalDrinkKey(getRowValue(row, "Drink")),
    storage: parseInteger(getRowValue(row, "Storage")),
  }));

  const slotAllocations = fillSlotsAcrossMachinesFromStorage(
    new Map(parsedRows.map((row) => [row.drinkKey, row.storage])),
    candidateSlots,
  );

  const drinks = parsedRows.map((row) => {
    const drink = { drink: row.drink, storage: row.storage };
    for (const config of MACHINE_CONFIG) {
      drink[`to${config.label}`] = slotAllocations
        .filter(
          (allocation) =>
            allocation.machineLabel === config.label &&
            allocation.drinkKey === row.drinkKey,
        )
        .reduce((sum, allocation) => sum + allocation.allocation, 0);
    }
    return drink;
  });

  return {
    batchId: `${KITCHEN_LABEL}-${date}`,
    event: RESTOCK_EVENTS.SPLIT,
    drinks,
    warnings,
  };
}

/**
 * Builds the machine slot form payload for the next restock event for a
 * machine/date. An unfinished submit is returned as stored. `logRows` and
 * `machineProducts` can be passed in by a caller that already read them.
 */
export async function buildRestockData(machineConfig, date, options = {}) {
  const batchId = `${machineConfig.label}-${date}`;
  const logRows = options.logRows ?? (await readRestockLog()).rows;
  const clearoutMode =
    normalizeRequestedMode(options.mode ?? options.event) ===
    RESTOCK_EVENTS.CLEAROUT.toLowerCase();
  const batchRows = getBatchLogRows(logRows, batchId);
  const unfinished = (
    clearoutMode ? [batchRows.clearout] : [batchRows.load, batchRows.topoff]
  ).find(
    (row) => row?.[RESTOCK_LOG_HEADER.STATUS] === SUBMIT_STATUS.NAYAX_PENDING,
  );
  if (unfinished) return prefillFromLogRow(batchId, unfinished);

  const kitchenRows = getBatchLogRows(logRows, `${KITCHEN_LABEL}-${date}`);
  const event = clearoutMode
    ? RESTOCK_EVENTS.CLEAROUT
    : !batchRows.load
      ? RESTOCK_EVENTS.LOAD
      : batchRows.topoff || kitchenRows.split
        ? RESTOCK_EVENTS.TOPOFF
        : RESTOCK_EVENTS.SPLIT;
  const violation = batchRuleViolation({
    rows: logRows,
    batchRows,
    machineLabel: machineConfig.label,
    batchId,
    event,
  });
  if (violation) throw new RestockError(violation.error, violation.details);
  const doneRow = batchRows[event.toLowerCase()];
  if (doneRow)
    throw new RestockError(ERRORS.batchFullyLogged, {
      existingEntryRow: doneRow._rowNumber,
    });

  if (event === RESTOCK_EVENTS.SPLIT) return buildSplitData(date);

  // call Nayax and sheets in parallel to reduce latency
  const [machineProducts, sheetRows] = await Promise.all([
    options.machineProducts ?? getMachineProducts(machineConfig.machineId),
    event === RESTOCK_EVENTS.LOAD
      ? loadProductionPlanRows()
      : event === RESTOCK_EVENTS.TOPOFF
        ? readInventoryRows(date)
        : null,
  ]);

  const warnings = [];
  const slots = buildMachineSlots(
    machineProducts,
    machineConfig,
    event,
    warnings,
  );

  if (event === RESTOCK_EVENTS.LOAD) {
    const last = lastMachineBatchEvent(logRows, machineConfig.label);
    if (last && last[RESTOCK_LOG_HEADER.EVENT] === RESTOCK_EVENTS.LOAD)
      addWarning(warnings, {
        code: "OPEN_BATCH_CLEARED_OUT",
        batchId: last[RESTOCK_LOG_HEADER.BATCH_ID],
        message: WARNINGS.openBatchClearedOut(
          last[RESTOCK_LOG_HEADER.BATCH_ID],
        ),
      });
    for (const slot of slots) {
      Object.assign(slot, {
        flavor: null,
        size: null,
        topping: null,
        sweetness: null,
      });
      slot.total = totalAfter(slot.previous, slot.waste, slot.expectedNew);
    }

    const rows = sheetRows;
    const amountHeader = getAmountHeader(machineConfig);
    const slotHeader = getSlotHeader(machineConfig);
    assertReadableDrinks(
      "Production Plan",
      machineConfig.label,
      rows,
      getPlanVariation,
      (row) => parseInteger(getRowValue(row, amountHeader)) > 0,
    );
    for (const row of rows) {
      const drink = normalizeDrinkName(getPlanVariation(row));
      const amount = parseInteger(getRowValue(row, amountHeader));
      const slotNumbers = parseSlots(getRowValue(row, slotHeader));
      const added = distributeDrinkAcrossSlots(
        amount,
        slotNumbers.map(() => ({
          start: 0,
          capacity: slotCapacityForDrink(drink),
        })),
      );
      slotNumbers.forEach((slotNumber, index) => {
        const slot = slots.find((s) => s.slotNumber === slotNumber);
        if (!slot || added[index] === 0) return;
        const parsedDrink = parseDrinkName(drink);
        Object.assign(slot, {
          flavor: parsedDrink.flavor || null,
          size: parsedDrink.size || null,
          topping: parsedDrink.topping || null,
          sweetness: parsedDrink.sweetness || null,
          expectedNew: added[index],
        });
        slot.total = totalAfter(slot.previous, slot.waste, slot.expectedNew);
      });
    }
  }

  if (event === RESTOCK_EVENTS.TOPOFF) {
    const inventoryRows = sheetRows;
    const inventoryMachineHeader = getInventoryMachineHeader(machineConfig);

    const storageByDrink = new Map(
      inventoryRows.map((row) => [
        canonicalDrinkKey(getRowValue(row, "Drink")),
        parseInteger(getRowValue(row, inventoryMachineHeader)),
      ]),
    );

    assertReadableDrinks(
      `Inventory tab ${inventoryTabName(date)}`,
      machineConfig.label,
      inventoryRows,
      (row) => getRowValue(row, "Drink"),
      (row) => parseInteger(getRowValue(row, inventoryMachineHeader)) > 0,
    );

    const candidateSlots = getTopoffCandidates(machineConfig, slots);

    for (const allocation of fillSlotsAcrossMachinesFromStorage(
      storageByDrink,
      candidateSlots,
    )) {
      const slot = slots.find((s) => s.slotNumber === allocation.slotNumber);
      slot.expectedNew = allocation.allocation;
      slot.total = totalAfter(slot.previous, slot.waste, slot.expectedNew);
    }
  }

  if (event === RESTOCK_EVENTS.CLEAROUT) {
    for (const slot of slots) {
      if (!slot.hasCurrentProduct) continue;
      slot.expectedNew = 0;
      slot.waste = slot.previous;
      slot.total = totalAfter(slot.previous, slot.waste, slot.expectedNew);
    }
  }

  for (const slot of slots) {
    delete slot.hasCurrentProduct;
  }

  return {
    batchId,
    event,
    slots,
    warnings,
  };
}
