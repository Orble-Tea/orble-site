// Pure builders for POST /api/restock-submit: request validation, Restock
// Log rows, the saga decision, and the Nayax write plan. The route does all
// the I/O.
import { RESTOCK_EVENTS } from "./config.js";
import { ERRORS, RestockError } from "./errors.js";
import { freeSpace, takesAllOut, totalAfter } from "./slot-validation-rules.js";
import {
  canonicalDrinkKey,
  canonicalDrinkKeyFromParts,
  formatDrinkName,
  slotCapacityForDrinkParts,
} from "./drinks.js";
import { getProductName, getProductSlot } from "./nayax.js";

/**
 * @typedef {{ flavor: string, size?: string, sweetness?: string, topping?: string }} DrinkParts
 * @typedef {{ slot: number, drink: DrinkParts | null, previousDrink: string | null, previous: number, waste: number, new: number }} SubmittedSlot
 *   One slot as the page confirmed it: what is there now, what came out, what went in.
 * @typedef {Record<string, string>} LogRow
 *   A Restock Log row keyed by column name (Batch ID, Event, Date, Duration, Slot Data, Status).
 * @typedef {Record<string, unknown>} SlotDataEntry
 *   One slot's entry in a row's Slot Data JSON; see slotEntry for the keys.
 */

export const RESTOCK_LOG_HEADER = [
  "Batch ID",
  "Event",
  "Date",
  "Duration",
  "Slot Data",
  "Status",
];

// A submit's progress, in the Status column of its log row(s)
export const SAGA_STATUS = {
  pending: "Pending",
  nayaxWritten: "Nayax written",
  complete: "Complete",
};

const hasDrink = (parts) => Boolean(parts?.flavor);

function sameDrink(parts, drinkName) {
  return canonicalDrinkKeyFromParts(parts) === canonicalDrinkKey(drinkName);
}

/**
 * Checks one slot's counts and drink against the event's rules.
 * @param {string} event Load, Topoff or Clearout
 * @param {SubmittedSlot} slot
 * @returns {string | null} the first problem, or null when the slot is fine
 */
function validateSlot(event, slot) {
  const label = `slot ${slot.slot}`;
  for (const field of ["previous", "waste", "new"]) {
    if (!Number.isInteger(slot[field]) || slot[field] < 0)
      return `${label}: ${field} must be a non-negative integer`;
  }
  if (slot.waste > slot.previous)
    return `${label}: waste ${slot.waste} exceeds previous ${slot.previous}`;

  if (takesAllOut(event) && slot.waste !== slot.previous)
    return `${label}: a ${event} must take out all ${slot.previous} previous`;
  if (event === RESTOCK_EVENTS.clearout && slot.new > 0)
    return `${label}: a Clearout cannot add drinks`;
  if (
    event === RESTOCK_EVENTS.topoff &&
    hasDrink(slot.drink) &&
    slot.previousDrink &&
    !sameDrink(slot.drink, slot.previousDrink)
  )
    return `${label}: a Topoff cannot change the drink`;

  // Nayax would drop the product while the log says drinks are left
  const total = totalAfter(slot.previous, slot.waste, slot.new);
  if (!hasDrink(slot.drink) && total > 0)
    return `${label}: a slot with no drink must end at 0, not ${total}`;

  const capacity = slotCapacityForDrinkParts(slot.drink || {});
  const free = freeSpace(slot.previous, slot.waste, event, capacity);
  if (slot.new > free)
    return `${label}: new ${slot.new} exceeds the ${free} free`;
  return null;
}

/**
 * Validates a submission. Every configured slot must appear exactly once and
 * pass validateSlot.
 * @param {{ event: string, slots: SubmittedSlot[], machineSlots: number[] }} submission
 * @returns {string | null} the first problem as a readable message, or null when valid
 */
export function validateSubmission({ event, slots, machineSlots }) {
  const configured = new Set(machineSlots);
  const seen = new Set();
  for (const slot of slots) {
    if (seen.has(slot.slot)) return `slot ${slot.slot} appears more than once`;
    seen.add(slot.slot);
    if (!configured.has(slot.slot))
      return `slot ${slot.slot} is not configured on this machine`;
  }
  for (const slot of machineSlots) {
    if (!seen.has(slot)) return `slot ${slot} is missing`;
  }
  for (const slot of slots) {
    const problem = validateSlot(event, slot);
    if (problem) return problem;
  }
  return null;
}

/**
 * The GET slot's prefill as Slot Data's Expected fields.
 * @param {object | undefined} expected a slot from the GET prefill
 * @returns {SlotDataEntry} the Expected * keys only
 */
function expectedFields(expected) {
  return {
    "Expected Drink": formatDrinkName(expected) || null,
    "Expected Previous Drink": expected?.previousDrink ?? null,
    "Expected Previous": expected?.previous ?? 0,
    "Expected Waste": expected?.waste ?? 0,
    "Expected New": expected?.expectedNew ?? 0,
  };
}

/**
 * One slot's confirmed state next to the prefill it started from.
 * @param {SubmittedSlot} slot
 * @param {SlotDataEntry} [expected] the Expected * fields to carry over
 * @returns {SlotDataEntry}
 */
function slotEntry(slot, expected = {}) {
  return {
    Slot: slot.slot,
    Drink: formatDrinkName(slot.drink) || null,
    "Expected Drink": expected["Expected Drink"] ?? null,
    "Previous Drink": slot.previousDrink ?? null,
    "Expected Previous Drink": expected["Expected Previous Drink"] ?? null,
    Previous: slot.previous,
    "Expected Previous": expected["Expected Previous"] ?? 0,
    Waste: slot.waste,
    "Expected Waste": expected["Expected Waste"] ?? 0,
    New: slot.new,
    "Expected New": expected["Expected New"] ?? 0,
    Total: totalAfter(slot.previous, slot.waste, slot.new),
  };
}

/**
 * @param {string | undefined} text a row's Slot Data cell
 * @returns {SlotDataEntry[]} empty when the cell is blank
 */
export const parseSlotData = (text) => JSON.parse(text || "[]");

/**
 * Restock Log rows for a submission. Every row carries every slot as JSON in
 * Slot Data. A Load writes a Clearout row closing the previous batch (when
 * there is one) and a Load row; a Topoff or a standalone Clearout writes one row.
 * @param {{ batchId: string, previousBatchId: string | null, visitDate: string, duration: string, event: string, submittedSlots: SubmittedSlot[], expectedSlots: object[], status?: string }} input
 *   previousBatchId is the batch a Load closes out; expectedSlots is the GET
 *   prefill the restocker started from; status defaults to Pending
 * @returns {LogRow[]} one or two rows
 */
export function buildRestockLogRows({
  batchId,
  previousBatchId,
  visitDate,
  duration = "",
  event,
  submittedSlots,
  expectedSlots,
  status = SAGA_STATUS.pending,
}) {
  const expectedBySlot = new Map(expectedSlots.map((s) => [s.slot, s]));
  const slotData = JSON.stringify(
    submittedSlots.map((slot) =>
      slotEntry(slot, expectedFields(expectedBySlot.get(slot.slot))),
    ),
  );
  const row = (rowBatchId, rowEvent) => ({
    "Batch ID": rowBatchId,
    Event: rowEvent,
    Date: visitDate,
    Duration: duration,
    "Slot Data": slotData,
    Status: status,
  });
  if (event === RESTOCK_EVENTS.load && previousBatchId)
    return [row(previousBatchId, RESTOCK_EVENTS.clearout), row(batchId, event)];
  return [row(batchId, event)];
}

/**
 * Slot Data for an edited resend: the new counts, the first attempt's Expected values.
 * @param {SubmittedSlot[]} submittedSlots
 * @param {SlotDataEntry[]} storedEntries the row's current Slot Data
 * @returns {string} the new Slot Data JSON
 */
export function rewriteSlotData(submittedSlots, storedEntries) {
  const storedBySlot = new Map(storedEntries.map((e) => [e.Slot, e]));
  return JSON.stringify(
    submittedSlots.map((slot) => slotEntry(slot, storedBySlot.get(slot.slot))),
  );
}

/**
 * Whether a request carries the same confirmed state as a stored submit.
 * @param {SubmittedSlot[]} submittedSlots
 * @param {SlotDataEntry[]} storedEntries the row's Slot Data
 * @returns {boolean}
 */
export function sameSlots(submittedSlots, storedEntries) {
  const fromRequest = submittedSlots.map((s) =>
    JSON.stringify([
      s.slot,
      formatDrinkName(s.drink) || null,
      s.previousDrink ?? null,
      s.previous,
      s.waste,
      s.new,
    ]),
  );
  const fromLog = storedEntries.map((e) =>
    JSON.stringify([
      e.Slot,
      e.Drink,
      e["Previous Drink"],
      e.Previous,
      e.Waste,
      e.New,
    ]),
  );
  return JSON.stringify(fromRequest.sort()) === JSON.stringify(fromLog.sort());
}

const lower = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

/**
 * @param {LogRow} row
 * @returns {boolean} whether an earlier press left this row short of Complete
 */
export const isUnfinished = (row) =>
  row.Status === SAGA_STATUS.pending || row.Status === SAGA_STATUS.nayaxWritten;

/**
 * The batch's latest row per event, from one bottom-up scan of the log. The
 * log is append-only, so today's rows sit at the bottom; an older duplicate
 * from a race is ignored.
 * @param {LogRow[]} rows the whole Restock Log, oldest first
 * @param {string} batchId
 * @returns {{ load?: LogRow, topoff?: LogRow, clearout?: LogRow }}
 */
export function getBatchLogRows(rows, batchId) {
  const found = {};
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (lower(row["Batch ID"]) !== lower(batchId)) continue;
    const key = lower(row.Event);
    if (!(key in found)) found[key] = row;
  }
  return {
    load: found[lower(RESTOCK_EVENTS.load)],
    topoff: found[lower(RESTOCK_EVENTS.topoff)],
    clearout: found[lower(RESTOCK_EVENTS.clearout)],
  };
}

/**
 * What a submit does given the Restock Log. The event's row for this batch
 * comes first, so a failed submit can always finish; only without one do the
 * batch rules apply.
 * @param {{ rows: LogRow[], batchId: string, event: string, submittedSlots: SubmittedSlot[] }} input
 *   rows is the whole Restock Log, oldest first
 * @returns {{ action: "append" }
 *   | { action: "resume", from: "nayax" | "inventory", overwrite: boolean, row: LogRow }
 *   | { action: "done", row: LogRow }
 *   | { action: "reject", error: import("./errors.js").ErrorSpec }}
 *   resume from "nayax" redoes the Nayax write, from "inventory" skips to the
 *   tail; overwrite replaces the row's Slot Data first. done means already
 *   Complete with these slots.
 */
export function decideSaga({ rows, batchId, event, submittedSlots }) {
  const batchRows = getBatchLogRows(rows, batchId);
  const eventRow = batchRows[lower(event)];
  if (eventRow) {
    const same = sameSlots(
      submittedSlots,
      parseSlotData(eventRow["Slot Data"]),
    );
    if (eventRow.Status === SAGA_STATUS.pending)
      return {
        action: "resume",
        from: "nayax",
        overwrite: !same,
        row: eventRow,
      };
    if (eventRow.Status === SAGA_STATUS.nayaxWritten)
      return same
        ? {
            action: "resume",
            from: "inventory",
            overwrite: false,
            row: eventRow,
          }
        : { action: "resume", from: "nayax", overwrite: true, row: eventRow };
    return same
      ? { action: "done", row: eventRow }
      : { action: "reject", error: ERRORS.alreadySubmitted };
  }

  if (batchRows.clearout)
    return { action: "reject", error: ERRORS.batchClearedOut };

  const loadDone = Boolean(batchRows.load) && !isUnfinished(batchRows.load);
  if (event === RESTOCK_EVENTS.clearout && !loadDone)
    return { action: "reject", error: ERRORS.clearoutRequiresLoad };
  if (event === RESTOCK_EVENTS.topoff && !loadDone)
    return {
      action: "reject",
      error: ERRORS.needsEventFirst(RESTOCK_EVENTS.load, event),
    };
  return { action: "append" };
}

/**
 * Maps a row object onto a sheet's header order; unknown columns stay blank.
 * @param {string[]} header the sheet's header row
 * @param {Record<string, unknown>} row values keyed by column name
 * @returns {unknown[]} one sheet row in header order
 */
export function toSheetRow(header, row) {
  return header.map((column) => row[String(column).trim()] ?? "");
}

// Hand-made copies of a product, e.g. "Thai Tea 16oz Less Sugar 2",
// "Mango Passion Fruit Tea 16oz (3)", "Black Tea 16oz Less Sugar (temp-1)".
const COPY_SUFFIX = /\s*(\((?:\d+|temp-\d+|\d+\.\d+)\)|\s\d+)$/;

const hasValue = (value) =>
  value !== null && value !== undefined && value !== "";

/**
 * Product info per drink. The operator's catalog decides which Nayax product
 * a drink is (active products only, originals over suffixed copies). The DEX
 * name and prices come from a machine slot already using that product, since
 * Nayax keeps them per slot and many catalog entries leave them blank; the
 * catalog's own values are the fallback.
 * @param {object[]} catalogProducts Nayax operator products
 * @param {object[]} [machineProducts] machine products from every machine, for DEX names and prices
 * @returns {Map<string, { NayaxProductID: unknown, DEXProductName: unknown, CashPrice: unknown, CreditCardPrice: unknown }>}
 *   keyed by canonical drink key
 */
export function buildNayaxCatalog(catalogProducts, machineProducts = []) {
  const chosen = new Map();
  for (const product of catalogProducts) {
    if (product.ProductStatus !== 1) continue;
    const name = String(product.ProductName || "");
    const key = canonicalDrinkKey(name.replace(COPY_SUFFIX, ""));
    if (!key) continue;
    const isCopy = COPY_SUFFIX.test(name);
    const current = chosen.get(key);
    if (!current || (current.isCopy && !isCopy))
      chosen.set(key, { product, isCopy });
  }

  const slotFor = new Map();
  for (const slot of machineProducts) {
    if (!hasValue(slot.DEXProductName) || !hasValue(slot.CashPrice)) continue;
    if (!slotFor.has(slot.NayaxProductID))
      slotFor.set(slot.NayaxProductID, slot);
  }

  const catalog = new Map();
  for (const [key, { product }] of chosen) {
    const slot = slotFor.get(product.NayaxProductID);
    catalog.set(key, {
      NayaxProductID: product.NayaxProductID,
      DEXProductName: slot ? slot.DEXProductName : product.DEXProductName,
      CashPrice: slot ? slot.CashPrice : product.ProductCashPrice,
      CreditCardPrice: slot
        ? slot.CreditCardPrice
        : product.ProductCreditCardPrice,
    });
  }
  return catalog;
}

/**
 * The catalog product for a drink.
 * @param {ReturnType<typeof buildNayaxCatalog>} catalog
 * @param {DrinkParts} drink
 * @returns {{ NayaxProductID: unknown, DEXProductName: unknown, CashPrice: unknown, CreditCardPrice: unknown }}
 * @throws {RestockError} 400 unknownProduct or incompleteProduct when Nayax has no usable product
 */
function lookupProduct(catalog, drink) {
  const entry = catalog.get(canonicalDrinkKeyFromParts(drink));
  if (!entry)
    throw new RestockError(ERRORS.unknownProduct(formatDrinkName(drink)));
  // A blank price would make the slot free, so refuse rather than write it.
  const complete = [
    entry.DEXProductName,
    entry.CashPrice,
    entry.CreditCardPrice,
  ].every(hasValue);
  if (!complete)
    throw new RestockError(ERRORS.incompleteProduct(formatDrinkName(drink)));
  return entry;
}

function alreadyMatches(product, total) {
  return (
    Number(product.PAR) === total &&
    product.MissingStockByMDB !== null &&
    product.MissingStockByMDB !== undefined &&
    Number(product.MissingStockByMDB) === 0
  );
}

/**
 * The Nayax writes for a submission. `put` is the machine's whole product list
 * for one full replace: changed slots get PAR = total and missing stock reset
 * (Nayax's count is PAR minus missing stock), emptied slots are left out,
 * everything else is sent back as read. `post` creates slots Nayax does not
 * have yet; the route PUTs again with the created records.
 * @param {{ currentProducts: object[], catalog: ReturnType<typeof buildNayaxCatalog>, slots: { slot: number, drink: DrinkParts | null, total: number }[] }} input
 *   currentProducts as read from Nayax; slots is what each slot should hold after the visit
 * @returns {{ put: object[] | null, post: object[] }} put is null when nothing differs
 * @throws {RestockError} via lookupProduct when a drink has no usable Nayax product
 */
export function buildNayaxUpdate({ currentProducts, catalog, slots }) {
  const submittedBySlot = new Map(slots.map((s) => [s.slot, s]));
  const existingSlots = new Set(currentProducts.map(getProductSlot));
  let changed = false;
  const put = [];
  for (const current of currentProducts) {
    const submitted = submittedBySlot.get(getProductSlot(current));
    if (!submitted) {
      put.push(current);
      continue;
    }
    const { drink, total } = submitted;
    if (!hasDrink(drink)) {
      changed = true;
      continue;
    }
    if (sameDrink(drink, getProductName(current))) {
      if (alreadyMatches(current, total)) {
        put.push(current);
        continue;
      }
      put.push({ ...current, PAR: total, MissingStockByMDB: 0 });
    } else {
      put.push({
        ...current,
        ...lookupProduct(catalog, drink),
        PAR: total,
        MissingStockByMDB: 0,
      });
    }
    changed = true;
  }

  const post = slots
    .filter(({ slot, drink }) => hasDrink(drink) && !existingSlots.has(slot))
    .map(({ slot, drink, total }) => ({
      ...lookupProduct(catalog, drink),
      MDBCode: slot,
      PAR: total,
      // Nayax ignores missing stock on create; the PUT after the re-read sets it
    }));
  return { put: changed ? put : null, post };
}
