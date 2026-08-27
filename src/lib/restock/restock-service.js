import {
  assertConfigured,
  getAmountHeader,
  getMachineSlotCount,
  getSlotHeader,
  PRODUCTION_PLAN_SHEET,
  RESTOCK_LOG_SHEET,
  RESTOCK_EVENTS,
  SHEET_IDS,
  VISITS_SHEET,
} from "./config.js";
import { AlreadySubmittedError } from "./errors.js";
import {
  appendSheetValues,
  getLatestSheetName,
  readLatestSheetValues,
  readSheetValues,
  rowsToObjects,
  updateSheetValues,
} from "./google-sheets.js";
import {
  createMachineProducts,
  getCashPrice,
  getCreditCardPrice,
  getMachineProducts,
  getMachineProductId,
  getNayaxProductId,
  getProductOnHand,
  getProductName,
  getProductPar,
  getProductSlot,
  hasProductOnHand,
  updateMachineProducts,
} from "./nayax.js";
import {
  canonicalDrinkKey,
  normalizeDrinkName,
  parseDrinkName,
  slotCapacityForDrink,
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

function sheetRowUrl(spreadsheetId, rowNumber) {
  if (!spreadsheetId || !rowNumber) return null;
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#range=A${rowNumber}`;
}

function combineDrinkName(parsed) {
  return normalizeDrinkName(
    [
      parsed.flavor,
      parsed.sweetness,
      parsed.topping ? `w/ ${parsed.topping}` : "",
      parsed.size,
    ]
      .filter(Boolean)
      .join(" "),
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
  const displayDrink =
    current && (parsed.flavor || parsed.size)
      ? combineDrinkName(parsed)
      : currentDrink;
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
    drink: displayDrink,
    previousDrink: displayDrink,
    flavor: parsed.flavor || null,
    size: parsed.size || null,
    topping: parsed.topping || null,
    sweetnessLevel: parsed.sweetness || null,
    previous,
    waste,
    expectedNew: 0,
    new: 0,
    total: previous - waste,
    empty: !current,
  };
}

function updateSlotTotals(slot) {
  slot.total = Math.max(slot.previous - slot.waste + slot.new, 0);
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

function getPlanNayaxProductId(row) {
  return (
    row.NayaxProductID ||
    row["Nayax Product ID"] ||
    row.NayaxProductId ||
    row.ProductID ||
    row["Product ID"] ||
    row.productId ||
    ""
  );
}

function getPlanCashPrice(row) {
  return row.CashPrice || row["Cash Price"] || row.Cash || row.cashPrice || 0;
}

function getPlanCreditCardPrice(row) {
  return (
    row.CreditCardPrice ||
    row["Credit Card Price"] ||
    row.CreditPrice ||
    row["Credit Price"] ||
    row.creditCardPrice ||
    getPlanCashPrice(row)
  );
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

function buildProductLookup(machineProducts, productionRows) {
  const byDrink = new Map();

  for (const product of machineProducts) {
    const drink = normalizeDrinkName(getProductName(product));
    if (!drink) continue;
    const key = canonicalDrinkKey(drink);
    if (!byDrink.has(key)) byDrink.set(key, {});
    Object.assign(byDrink.get(key), {
      nayaxProductId: getNayaxProductId(product),
      cashPrice: getCashPrice(product),
      creditCardPrice: getCreditCardPrice(product),
    });
  }

  for (const row of productionRows) {
    const drink = normalizeDrinkName(getPlanVariation(row));
    if (!drink) continue;
    const key = canonicalDrinkKey(drink);
    if (!byDrink.has(key)) byDrink.set(key, {});
    const entry = byDrink.get(key);
    entry.nayaxProductId ||= getPlanNayaxProductId(row);
    entry.cashPrice ||= getPlanCashPrice(row);
    entry.creditCardPrice ||= getPlanCreditCardPrice(row);
  }

  return byDrink;
}

function parseSubmittedSlots(slots) {
  if (!Array.isArray(slots)) throw new Error("slots must be an array");
  return slots.map((slot) => {
    const slotNumber = Number(slot.slot);
    const waste = Number(slot.waste);
    const added = Number(slot.new);
    if (!Number.isInteger(slotNumber) || slotNumber < 1) {
      throw new Error("slots[].slot must be a positive integer");
    }
    if (!Number.isInteger(waste) || waste < 0) {
      throw new Error("slots[].waste must be a non-negative integer");
    }
    if (!Number.isInteger(added) || added < 0) {
      throw new Error("slots[].new must be a non-negative integer");
    }
    return { slot: slotNumber, waste, new: added };
  });
}

function normalizeSubmittedEvent(event) {
  const normalized = String(event || "")
    .trim()
    .toLowerCase();
  const match = Object.values(RESTOCK_EVENTS).find(
    (candidate) => candidate.toLowerCase() === normalized,
  );
  if (!match) throw new Error("Invalid event");
  return match;
}

function columnLetter(index) {
  let remaining = index + 1;
  let letters = "";
  while (remaining > 0) {
    const modulo = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + modulo) + letters;
    remaining = Math.floor((remaining - modulo) / 26);
  }
  return letters;
}

async function clearTopoffInventoryForMachine(
  machineConfig,
  submittedSlotStates,
) {
  const spreadsheetId = assertConfigured(
    SHEET_IDS.inventory,
    "INVENTORY_SHEET_ID",
  );
  const latestSheetName = await getLatestSheetName(spreadsheetId);
  const values = await readSheetValues(spreadsheetId, latestSheetName);
  const headers = values[0] || [];
  const rows = rowsToObjects(values);
  if (rows.length === 0) return;

  const preferredHeader = `Storage (${machineConfig.label})`;
  const storageHeader = headers.includes(preferredHeader)
    ? preferredHeader
    : "Storage";
  const storageIndex = headers.indexOf(storageHeader);
  if (storageIndex === -1) return;

  const submittedDrinkKeys = new Set(
    submittedSlotStates
      .map((slot) => canonicalDrinkKey(slot.drink))
      .filter(Boolean),
  );
  const updates = rows
    .filter((row) => submittedDrinkKeys.has(canonicalDrinkKey(row.Drink)))
    .map((row) => ({
      range: `${columnLetter(storageIndex)}${row._rowNumber}`,
      values: [[0]],
    }));

  for (const update of updates) {
    await updateSheetValues(
      spreadsheetId,
      latestSheetName,
      update.range,
      update.values,
    );
  }
}

async function notifySlack({ event, machine, date, logUrl }) {
  const webhookUrl =
    process.env.SLACK_RESTOCK_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const text = `✅ ${event} complete - ${machine}, ${date}. View log${logUrl ? ` ${logUrl}` : ""}`;
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    throw new Error(`Slack notification failed with status ${response.status}`);
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

async function assertEventNotSubmitted(batchId, event) {
  const rows = await readRestockLogRows();
  const existing = rows.find(
    (row) =>
      row["Batch ID"] === batchId &&
      String(row.Event).toLowerCase() === event.toLowerCase(),
  );
  if (existing) {
    throw new AlreadySubmittedError(
      `This ${event} has already been submitted.`,
      existing._rowNumber,
    );
  }
}

/** Builds the machine slot form payload for the next restock event for a machine/date. */
export async function buildRestockData(machineConfig, date, options = {}) {
  const batchId = `${machineConfig.label}-${date}`;
  const event = await determineEvent(batchId, options);

  const machineProducts = await getMachineProducts(machineConfig.machineId);
  const productBySlot = toSlotMap(machineProducts);
  const warnings = [];
  const slots = Array.from(
    { length: getMachineSlotCount(machineConfig) },
    (_, index) => {
      const slot = index + 1;
      const current = productBySlot.get(slot);
      return makeSlotState(slot, current, event, warnings);
    },
  );

  if (event === RESTOCK_EVENTS.load) {
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
          drink: combineDrinkName(parsedDrink),
          expectedNew: allocation.quantity,
          new: allocation.quantity,
          empty: false,
        });
        updateSlotTotals(slot);
      }
    }
  }

  if (event === RESTOCK_EVENTS.topoff) {
    const inventoryRows = await readInventoryRows();
    const storageByDrink = new Map(
      inventoryRows.map((row) => [
        canonicalDrinkKey(row.Drink),
        parseInteger(row.Storage),
      ]),
    );

    for (const slot of slots) {
      if (slot.empty) continue;
      const drink = normalizeDrinkName(
        [
          slot.flavor,
          slot.sweetnessLevel,
          slot.topping ? `w/ ${slot.topping}` : "",
          slot.size,
        ]
          .filter(Boolean)
          .join(" "),
      );
      const storageKey = canonicalDrinkKey(drink);
      const storage = storageByDrink.get(storageKey) || 0;
      const capacityLeft = Math.max(
        slotCapacityForDrink(drink) - slot.previous,
        0,
      );
      const quantity = Math.min(storage, capacityLeft);
      slot.drink = drink;
      slot.expectedNew = quantity;
      slot.new = quantity;
      updateSlotTotals(slot);
      storageByDrink.set(storageKey, storage - quantity);
    }
  }

  if (event === RESTOCK_EVENTS.clearout) {
    for (const slot of slots) {
      if (slot.empty) continue;
      slot.drink = combineDrinkName({
        flavor: slot.flavor,
        sweetness: slot.sweetnessLevel,
        topping: slot.topping,
        size: slot.size,
      });
      slot.expectedNew = 0;
      slot.new = 0;
      slot.waste = slot.previous;
      updateSlotTotals(slot);
    }
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

export async function submitRestock(machineConfig, payload) {
  const date = String(payload.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date");

  const event = normalizeSubmittedEvent(payload.event);
  const batchId = `${machineConfig.label}-${date}`;
  if (payload.batchId !== batchId) {
    throw new Error("batchId does not match machine and date");
  }
  if (payload.machine !== machineConfig.label) {
    throw new Error("machine does not match configured machine");
  }

  const submittedSlots = parseSubmittedSlots(payload.slots);
  const submittedBySlot = new Map(
    submittedSlots.map((slot) => [slot.slot, slot]),
  );
  if (submittedBySlot.size !== submittedSlots.length) {
    throw new Error("Duplicate submitted slots");
  }
  const maxSlot = getMachineSlotCount(machineConfig);
  if (submittedSlots.some((slot) => slot.slot > maxSlot)) {
    throw new Error(`slots[].slot must be between 1 and ${maxSlot}`);
  }

  await assertEventNotSubmitted(batchId, event);

  const [prefill, machineProducts, productionRows] = await Promise.all([
    buildRestockData(machineConfig, date, {
      mode: event === RESTOCK_EVENTS.clearout ? "clearout" : null,
    }),
    getMachineProducts(machineConfig.machineId),
    loadProductionPlanRows().catch(() => []),
  ]);

  if (prefill.event !== event) {
    throw new Error(`Expected next event to be ${prefill.event}, not ${event}`);
  }

  const currentBySlot = toSlotMap(machineProducts);
  const productLookup = buildProductLookup(machineProducts, productionRows);
  const logRows = [];
  const nayaxUpdates = [];
  const nayaxCreates = [];
  const submittedSlotStates = [];

  for (const submitted of submittedSlots) {
    const slot = prefill.slots[submitted.slot - 1];
    if (!slot || slot.empty) {
      throw new Error(`Slot ${submitted.slot} is empty or unknown`);
    }

    const previous = slot.previous;
    const waste = submitted.waste;
    const added = submitted.new;
    if (waste > previous) {
      throw new Error(`Slot ${submitted.slot} waste exceeds previous count`);
    }

    const total = Math.max(previous - waste + added, 0);
    const drink = normalizeDrinkName(slot.drink);
    const expected = slot.expectedNew;
    const current = currentBySlot.get(submitted.slot);
    const currentDrink = current
      ? normalizeDrinkName(getProductName(current))
      : "";
    const machineProductId = current ? getMachineProductId(current) : null;
    const productInfo = productLookup.get(canonicalDrinkKey(drink)) || {};
    const currentProductId =
      current && canonicalDrinkKey(currentDrink) === canonicalDrinkKey(drink)
        ? getNayaxProductId(current)
        : null;
    const nayaxProductId = productInfo.nayaxProductId || currentProductId;

    if (!nayaxProductId) {
      throw new Error(`Missing Nayax product ID for slot ${submitted.slot}`);
    }

    if (event === RESTOCK_EVENTS.load) {
      const remainingAfterClearout = Math.max(previous - waste, 0);
      logRows.push([
        batchId,
        RESTOCK_EVENTS.clearout,
        date,
        submitted.slot,
        drink,
        previous,
        waste,
        0,
        remainingAfterClearout,
        0,
      ]);
      logRows.push([
        batchId,
        RESTOCK_EVENTS.load,
        date,
        submitted.slot,
        drink,
        remainingAfterClearout,
        0,
        added,
        total,
        expected,
      ]);
    } else {
      logRows.push([
        batchId,
        event,
        date,
        submitted.slot,
        drink,
        previous,
        waste,
        added,
        total,
        expected,
      ]);
    }

    const nayaxPayload = {
      NayaxProductID: nayaxProductId,
      MachineID: machineConfig.machineId,
      MDBCode: submitted.slot,
      PAR: total,
      DEXProductName: drink,
    };

    if (machineProductId) {
      nayaxUpdates.push({
        MachineProductID: machineProductId,
        ...nayaxPayload,
      });
    } else {
      nayaxCreates.push({
        NayaxProductID: nayaxProductId,
        MDBCode: submitted.slot,
        PAR: total,
        DEXProductName: drink,
        CashPrice: productInfo.cashPrice || 0,
        CreditCardPrice:
          productInfo.creditCardPrice || productInfo.cashPrice || 0,
      });
    }

    submittedSlotStates.push({ ...slot, waste, new: added, total, drink });
  }

  if (nayaxUpdates.length > 0) {
    await updateMachineProducts(machineConfig.machineId, nayaxUpdates);
  }
  if (nayaxCreates.length > 0) {
    await createMachineProducts(machineConfig.machineId, nayaxCreates);
  }

  const restockLogSheetId = assertConfigured(
    SHEET_IDS.restockLog,
    "RESTOCK_LOG_SHEET_ID",
  );
  const appendResult = await appendSheetValues(
    restockLogSheetId,
    RESTOCK_LOG_SHEET,
    logRows,
  );
  await appendSheetValues(restockLogSheetId, VISITS_SHEET, [
    [batchId, date, String(payload.duration || "")],
  ]);

  if (event === RESTOCK_EVENTS.topoff) {
    await clearTopoffInventoryForMachine(machineConfig, submittedSlotStates);
  }

  const updatedRange = appendResult?.updates?.updatedRange || "";
  const firstRowMatch = updatedRange.match(/![A-Z]+(\d+)/);
  const firstWrittenRow = firstRowMatch ? Number(firstRowMatch[1]) : null;
  const logUrl = sheetRowUrl(restockLogSheetId, firstWrittenRow);
  await notifySlack({ event, machine: machineConfig.label, date, logUrl });

  return { success: true, message: "Restock complete" };
}
