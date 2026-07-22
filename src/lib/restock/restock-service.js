import {
  MACHINE_CONFIG,
  PRODUCTION_PLAN_SHEET,
  RESTOCK_LOG_SHEET,
  SHEET_IDS,
  VISITS_SHEET,
} from "./config.js";
import {
  appendSheetRows,
  columnToLetter,
  getHeaderIndex,
  readSheetValues,
  rowsToObjects,
  updateSheetValues,
} from "./google-sheets.js";
import {
  createMachineProducts,
  getMachineProductId,
  getMachineProducts,
  getNayaxProductId,
  getProductName,
  getProductPar,
  getProductSlot,
  updateMachineProducts,
} from "./nayax.js";
import { normalizeDrinkName, parseDrinkName, slotCapacityForDrink } from "./drinks.js";

function formatInventorySheetDate(date) {
  const [year, month, day] = String(date).split("-");
  if (!year || !month || !day) throw new Error("Invalid date");
  return `${month}/${day}/${year}`;
}

function parseInteger(value, fallback = 0) {
  if (value === "" || value === null || typeof value === "undefined") return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function parseSlots(value) {
  return String(value || "")
    .split(",")
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

function toProductIdMap(productsByMachine) {
  const map = new Map();
  for (const products of productsByMachine.values()) {
    for (const product of products) {
      const name = normalizeDrinkName(getProductName(product)).toLowerCase();
      const nayaxProductId = getNayaxProductId(product);
      if (name && nayaxProductId && !map.has(name)) map.set(name, nayaxProductId);
    }
  }
  return map;
}

function distributeAcrossSlots(total, slots, drink) {
  const capacity = slotCapacityForDrink(drink);
  let remaining = total;
  return slots.map((slot) => {
    const quantity = Math.min(capacity, remaining);
    remaining -= quantity;
    return { slot, quantity };
  });
}

async function loadProductionPlanRows() {
  const values = await readSheetValues(SHEET_IDS.productionPlan, PRODUCTION_PLAN_SHEET);
  return rowsToObjects(values).filter((row) => normalizeDrinkName(row.Variation));
}

async function loadRestockRows() {
  return rowsToObjects(await readSheetValues(SHEET_IDS.restockLog, RESTOCK_LOG_SHEET));
}

export async function determineEvent(batchId) {
  const rows = await loadRestockRows();
  const hasLoad = rows.some(
    (row) => row["Batch ID"] === batchId && String(row.Event).toLowerCase() === "load",
  );
  const hasTopoff = rows.some(
    (row) => row["Batch ID"] === batchId && String(row.Event).toLowerCase() === "topoff",
  );

  if (!hasLoad) return "Load";
  if (!hasTopoff) return "Topoff";

  const existing = rows.find((row) => row["Batch ID"] === batchId);
  return { alreadySubmitted: true, existingEntryUrl: existing?._rowNumber };
}

export async function assertNotSubmitted(batchId, event) {
  const rows = await loadRestockRows();
  const existing = rows.find(
    (row) =>
      row["Batch ID"] === batchId &&
      String(row.Event).toLowerCase() === String(event).toLowerCase(),
  );
  if (!existing) return null;
  return `#gid=0&range=A${existing._rowNumber}:J${existing._rowNumber}`;
}

export async function buildRestockData(machineConfig, date) {
  const batchId = `${machineConfig.label}-${date}`;
  const event = await determineEvent(batchId);
  if (event && typeof event === "object" && event.alreadySubmitted) {
    return event;
  }

  const machineProducts = await getMachineProducts(machineConfig.machineId);
  const productBySlot = toSlotMap(machineProducts);
  const slots = Array.from({ length: 35 }, (_, index) => {
    const slot = index + 1;
    const current = productBySlot.get(slot);
    return {
      slot,
      flavor: null,
      size: null,
      topping: null,
      sweetness: null,
      previous: current ? getProductPar(current) : 0,
      waste: event === "Load" && current ? getProductPar(current) : 0,
      new: 0,
      empty: true,
    };
  });

  if (event === "Load") {
    const rows = await loadProductionPlanRows();
    for (const row of rows) {
      const drink = normalizeDrinkName(row.Variation);
      const amount = parseInteger(row[machineConfig.amountHeader]);
      const slotNumbers = parseSlots(row[machineConfig.slotHeader]);
      for (const allocation of distributeAcrossSlots(amount, slotNumbers, drink)) {
        const slot = slots[allocation.slot - 1];
        if (!slot) continue;
        Object.assign(slot, parseDrinkName(drink), {
          new: allocation.quantity,
          empty: false,
        });
      }
    }
  } else {
    await applyTopoffPrefill(machineConfig, date, slots);
  }

  return {
    batchId,
    event,
    machine: machineConfig.label,
    date,
    slots,
  };
}

async function applyTopoffPrefill(machineConfig, date, slots) {
  const picklist = await buildPicklist(date, { sendSlack: false });
  const machinePicklist = picklist.machines.find(
    (machine) => machine.machine === machineConfig.label,
  );
  if (!machinePicklist) return;

  const remainingByDrink = new Map(
    machinePicklist.items.map((item) => [normalizeDrinkName(item.drink), item.quantity]),
  );

  for (const slot of slots) {
    if (slot.empty) continue;
    const drink = normalizeDrinkName(
      [slot.flavor, slot.sweetness, slot.topping ? `w/ ${slot.topping}` : "", slot.size]
        .filter(Boolean)
        .join(" "),
    );
    const remaining = remainingByDrink.get(drink) || 0;
    const capacity = slotCapacityForDrink(drink);
    const quantity = Math.min(Math.max(capacity - slot.previous, 0), remaining);
    slot.new = quantity;
    remainingByDrink.set(drink, remaining - quantity);
  }
}

async function loadInventoryRows(date) {
  const sheetName = formatInventorySheetDate(date);
  const values = await readSheetValues(SHEET_IDS.inventory, sheetName);
  const [headers = []] = values;
  const storageIndex = getHeaderIndex(headers, "Storage");
  if (storageIndex === -1) throw new Error("No inventory found for this date");

  return {
    sheetName,
    storageIndex,
    rows: rowsToObjects(values).filter((row) => normalizeDrinkName(row.Drink)),
  };
}

export async function buildPicklist(date, options = { sendSlack: true }) {
  const inventory = await loadInventoryRows(date);
  const allProducts = new Map();
  for (const machine of MACHINE_CONFIG) {
    if (!machine.machineId) continue;
    allProducts.set(machine.label, await getMachineProducts(machine.machineId));
  }

  const machines = MACHINE_CONFIG.map((machine) => ({ machine: machine.label, items: [] }));

  for (const row of inventory.rows) {
    const drink = normalizeDrinkName(row.Drink);
    let storage = parseInteger(row.Storage);
    if (!drink || storage <= 0) continue;

    const candidates = [];
    for (const [machineLabel, products] of allProducts.entries()) {
      for (const product of products) {
        if (normalizeDrinkName(getProductName(product)).toLowerCase() !== drink.toLowerCase()) {
          continue;
        }
        const capacityLeft = Math.max(
          slotCapacityForDrink(drink) - getProductPar(product),
          0,
        );
        if (capacityLeft > 0) {
          candidates.push({ machineLabel, capacityLeft, assigned: 0 });
        }
      }
    }

    candidates.sort((a, b) => b.capacityLeft - a.capacityLeft);
    while (storage > 0 && candidates.some((candidate) => candidate.capacityLeft > 0)) {
      for (const candidate of candidates) {
        if (storage <= 0) break;
        if (candidate.capacityLeft <= 0) continue;
        candidate.assigned += 1;
        candidate.capacityLeft -= 1;
        storage -= 1;
      }
    }

    for (const candidate of candidates) {
      if (candidate.assigned <= 0) continue;
      const machine = machines.find((item) => item.machine === candidate.machineLabel);
      const existing = machine.items.find((item) => item.drink === drink);
      if (existing) existing.quantity += candidate.assigned;
      else machine.items.push({ drink, quantity: candidate.assigned });
    }
  }

  const result = { date, machines };
  if (options.sendSlack) {
    const { sendPicklistSlack } = await import("./slack.js");
    await sendPicklistSlack(result);
  }
  return result;
}

export async function submitRestock(payload, machineConfig) {
  const existingEntryUrl = await assertNotSubmitted(payload.batchId, payload.event);
  if (existingEntryUrl) return { conflict: true, existingEntryUrl };

  const restockData = await buildRestockData(machineConfig, payload.date);
  const slotDetails = new Map(restockData.slots.map((slot) => [slot.slot, slot]));
  const submittedSlots = payload.slots || [];
  const currentProducts = await getMachineProducts(machineConfig.machineId);
  const productsBySlot = toSlotMap(currentProducts);
  const allProducts = new Map([[machineConfig.label, currentProducts]]);
  const productIdsByName = toProductIdMap(allProducts);
  const restockRows = [];
  const updates = [];
  const creates = [];

  for (const submitted of submittedSlots) {
    const slotNumber = parseInteger(submitted.slot, null);
    const detail = slotDetails.get(slotNumber);
    if (!detail || detail.empty) continue;

    const current = productsBySlot.get(slotNumber);
    const drink = normalizeDrinkName(
      [detail.flavor, detail.sweetness, detail.topping ? `w/ ${detail.topping}` : "", detail.size]
        .filter(Boolean)
        .join(" "),
    );
    const previous = current ? getProductPar(current) : detail.previous || 0;
    const waste = parseInteger(submitted.waste);
    const added = parseInteger(submitted.new);
    const total = payload.event === "Load" ? added : Math.max(previous - waste, 0) + added;
    const expected = detail.new;

    if (payload.event === "Load") {
      restockRows.push([
        payload.batchId,
        "Clearout",
        payload.date,
        slotNumber,
        drink,
        previous,
        waste,
        0,
        0,
        0,
      ]);
    }

    restockRows.push([
      payload.batchId,
      payload.event,
      payload.date,
      slotNumber,
      drink,
      previous,
      waste,
      added,
      total,
      expected,
    ]);

    if (current) {
      updates.push({
        ...current,
        MachineProductID: getMachineProductId(current),
        NayaxProductID:
          getNayaxProductId(current) || productIdsByName.get(drink.toLowerCase()),
        MachineID: machineConfig.machineId,
        MDBCode: slotNumber,
        PAR: total,
        DEXProductName: drink,
      });
    } else {
      const nayaxProductId = productIdsByName.get(drink.toLowerCase());
      if (!nayaxProductId) {
        throw new Error(`Missing NayaxProductID for new slot drink: ${drink}`);
      }
      creates.push({
        NayaxProductID: nayaxProductId,
        MDBCode: slotNumber,
        PAR: total,
        DEXProductName: drink,
        CashPrice: Number(process.env.NAYAX_DEFAULT_CASH_PRICE || 0),
        CreditCardPrice: Number(process.env.NAYAX_DEFAULT_CARD_PRICE || 0),
      });
    }
  }

  await appendSheetRows(SHEET_IDS.restockLog, RESTOCK_LOG_SHEET, restockRows);
  await appendSheetRows(SHEET_IDS.restockLog, VISITS_SHEET, [
    [
      payload.batchId,
      payload.event,
      payload.machine,
      payload.date,
      payload.duration || "",
      new Date().toISOString(),
      submittedSlots.length,
    ],
  ]);
  await updateMachineProducts(machineConfig.machineId, updates);
  await createMachineProducts(machineConfig.machineId, creates);

  if (payload.event === "Topoff") {
    await zeroInventoryStorage(payload.date, submittedSlots, slotDetails);
  }

  const { sendRestockSlack } = await import("./slack.js");
  await sendRestockSlack(payload, restockRows.length);

  return { success: true, message: "Restock complete" };
}

async function zeroInventoryStorage(date, submittedSlots, slotDetails) {
  const inventory = await loadInventoryRows(date);
  const drinks = new Set();
  for (const submitted of submittedSlots) {
    const detail = slotDetails.get(parseInteger(submitted.slot, null));
    if (!detail || detail.empty) continue;
    drinks.add(
      normalizeDrinkName(
        [detail.flavor, detail.sweetness, detail.topping ? `w/ ${detail.topping}` : "", detail.size]
          .filter(Boolean)
          .join(" "),
      ).toLowerCase(),
    );
  }

  const storageColumn = columnToLetter(inventory.storageIndex + 1);
  for (const row of inventory.rows) {
    if (!drinks.has(normalizeDrinkName(row.Drink).toLowerCase())) continue;
    await updateSheetValues(
      SHEET_IDS.inventory,
      inventory.sheetName,
      `${storageColumn}${row._rowNumber}`,
      [[0]],
    );
  }
}
