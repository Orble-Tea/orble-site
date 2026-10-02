// @steered AudibleSecurityContext 1.2 2026-10-01
// Pure builders for POST /api/restock-submit: request validation, Restock
// Log rows, the saga decision, and the Nayax write plan. The route does all
// the I/O.
import { RESTOCK_EVENTS } from "./config.js";
import { MESSAGES, needsEventFirst } from "./errors.js";
import { freeSpace, takesAllOut, totalAfter } from "./slot-validation-rules.js";
import {
  canonicalDrinkKey,
  canonicalDrinkKeyFromParts,
  REGULAR_SWEETNESS,
  slotCapacityForDrinkParts,
} from "./drinks.js";
import { getProductName, getProductSlot } from "./nayax.js";

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

/** Thrown when a drink has no usable Nayax product to copy onto a slot. */
export class UnknownProductError extends Error {
  constructor(drinkName, reason = "missing") {
    super(
      reason === "incomplete"
        ? `'${drinkName}' has no DEX name or prices in Nayax. Add them in Nayax, then submit again.`
        : `'${drinkName}' is not set up as a Nayax product. Add it in Nayax, then submit again.`,
    );
    this.name = "UnknownProductError";
    this.unknownProduct = true;
  }
}

/** Drink parts to the catalog name, e.g. "Thai Tea 16oz Less Sweet w/ Lychee". */
export function formatDrinkName(parts) {
  if (!parts?.flavor) return "";
  return [
    parts.flavor,
    parts.size,
    // Only sized drinks carry a sweetness; boba packs don't
    parts.size ? parts.sweetness || REGULAR_SWEETNESS : null,
    parts.topping ? `w/ ${parts.topping}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

const isCount = (value) => Number.isInteger(value) && value >= 0;
const hasDrink = (parts) => Boolean(parts?.flavor);

function sameDrink(parts, drinkName) {
  return canonicalDrinkKeyFromParts(parts) === canonicalDrinkKey(drinkName);
}

/** Checks one slot's counts and drink against the event's rules. */
function validateSlot(event, slot) {
  const label = `slot ${slot.slot}`;
  for (const field of ["previous", "waste", "new"]) {
    if (!isCount(slot[field]))
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
 * Validates a submission. Returns the first problem as a readable message,
 * or null when the submission is valid. Every configured slot must appear
 * exactly once.
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

/** The GET slot's prefill as Slot Data's Expected fields. */
function expectedFields(expected) {
  return {
    "Expected Drink": formatDrinkName(expected) || null,
    "Expected Previous Drink": expected?.previousDrink ?? null,
    "Expected Previous": expected?.previous ?? 0,
    "Expected Waste": expected?.waste ?? 0,
    "Expected New": expected?.expectedNew ?? 0,
  };
}

/** One slot's confirmed state next to the prefill it started from. */
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

export const parseSlotData = (text) => JSON.parse(text || "[]");

/**
 * Restock Log rows for a submission, as objects keyed by column name. Every
 * row carries every slot as JSON in Slot Data. A Load writes a Clearout row
 * closing the previous batch (when there is one) and a Load row; a Topoff
 * or a standalone Clearout writes one row.
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

/** Slot Data for an edited resend: the new counts, the first attempt's Expected values. */
export function rewriteSlotData(submittedSlots, storedEntries) {
  const storedBySlot = new Map(storedEntries.map((e) => [e.Slot, e]));
  return JSON.stringify(
    submittedSlots.map((slot) => slotEntry(slot, storedBySlot.get(slot.slot))),
  );
}

/** Whether a request carries the same confirmed state as a stored submit. */
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

const isEventRow = (row, batchId, event) =>
  lower(row["Batch ID"]) === lower(batchId) &&
  lower(row.Event) === lower(event);

export const isUnfinished = (row) =>
  row.Status === SAGA_STATUS.pending || row.Status === SAGA_STATUS.nayaxWritten;

/** The batch's first row for an event; later duplicates from a race are ignored. */
export const findEventRow = (rows, batchId, event) =>
  rows.find((row) => isEventRow(row, batchId, event));

/**
 * What a submit does given the Restock Log. The event's own row comes first,
 * so a failed submit can always finish; only without one do the batch rules
 * apply. Returns { action: "append" | "resume" | "done" | "reject", ... }.
 */
export function decideSaga({ rows, batchId, event, submittedSlots }) {
  const own = findEventRow(rows, batchId, event);
  if (own) {
    const same = sameSlots(submittedSlots, parseSlotData(own["Slot Data"]));
    if (own.Status === SAGA_STATUS.pending)
      return { action: "resume", from: "nayax", overwrite: !same, row: own };
    if (own.Status === SAGA_STATUS.nayaxWritten)
      return same
        ? { action: "resume", from: "inventory", overwrite: false, row: own }
        : { action: "resume", from: "nayax", overwrite: true, row: own };
    return same
      ? { action: "done", row: own }
      : { action: "reject", status: 409, error: MESSAGES.alreadySubmitted };
  }

  if (findEventRow(rows, batchId, RESTOCK_EVENTS.clearout))
    return { action: "reject", status: 409, error: MESSAGES.batchClearedOut };

  const load = findEventRow(rows, batchId, RESTOCK_EVENTS.load);
  const loadDone = Boolean(load) && !isUnfinished(load);
  if (event === RESTOCK_EVENTS.clearout && !loadDone)
    return {
      action: "reject",
      status: 409,
      error: MESSAGES.clearoutRequiresLoad,
    };
  if (event === RESTOCK_EVENTS.topoff && !loadDone)
    return {
      action: "reject",
      status: 400,
      error: needsEventFirst(RESTOCK_EVENTS.load, event),
    };
  return { action: "append" };
}

/** Maps a row object onto a sheet's header order; unknown columns stay blank. */
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

function lookupProduct(catalog, drink) {
  const entry = catalog.get(canonicalDrinkKeyFromParts(drink));
  if (!entry) throw new UnknownProductError(formatDrinkName(drink));
  // A blank price would make the slot free, so refuse rather than write it.
  const complete = [
    entry.DEXProductName,
    entry.CashPrice,
    entry.CreditCardPrice,
  ].every(hasValue);
  if (!complete)
    throw new UnknownProductError(formatDrinkName(drink), "incomplete");
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
 * The Nayax writes for a submission. `slots` are { slot, drink, total }.
 * `put` is the machine's whole product list for one full replace: changed
 * slots get PAR = total and missing stock reset (Nayax's count is PAR minus
 * missing stock), emptied slots are left out, everything else is sent back
 * as read. It is null when nothing differs. `post` creates slots Nayax does
 * not have yet; they need a re-read and a PUT afterwards.
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
