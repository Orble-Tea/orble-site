// Pure builders for the Nayax side of a submit: the product catalog, which
// slots to create and the machine products PUT. The route does all the I/O.
import { ERRORS, RestockError } from "./errors.js";
import {
  canonicalDrinkKey,
  canonicalDrinkKeyFromParts,
  formatDrinkName,
  sameDrink,
} from "./drink-parsing.js";
import { getProductName, getProductSlot } from "./nayax.js";

/**
 * @typedef {import("./restock-log.js").DrinkParts} DrinkParts
 * @typedef {import("./restock-log.js").SubmittedSlot} SubmittedSlot
 */

const hasValue = (value) => value != null && value !== "";

/**
 * Product info per drink. The operator's catalog decides which Nayax product
 * a drink is (active products only). The DEX name and prices come from a
 * machine slot already using that product, since Nayax keeps them per slot
 * and many catalog entries leave them blank; the catalog's own values are
 * the fallback.
 * @param {object[]} catalogProducts Nayax operator products
 * @param {object[]} [machineProducts] machine products from every machine, for DEX names and prices
 * @returns {Map<string, { NayaxProductID: unknown, DEXProductName: unknown, CashPrice: unknown, CreditCardPrice: unknown }>}
 *   keyed by canonical drink key
 */
export function buildNayaxCatalog(catalogProducts, machineProducts = []) {
  const chosen = new Map();
  for (const product of catalogProducts) {
    if (product.ProductStatus !== 1) continue;
    const key = canonicalDrinkKey(String(product.ProductName || ""));
    if (key && !chosen.has(key)) chosen.set(key, product);
  }

  const slotFor = new Map();
  for (const slot of machineProducts) {
    if (!hasValue(slot.DEXProductName) || !hasValue(slot.CashPrice)) continue;
    if (!slotFor.has(slot.NayaxProductID))
      slotFor.set(slot.NayaxProductID, slot);
  }

  const catalog = new Map();
  for (const [key, product] of chosen) {
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
 * Whether a catalog entry has everything a slot record needs. A blank price
 * would make the slot free, so an incomplete entry is never written.
 * @param {{ DEXProductName: unknown, CashPrice: unknown, CreditCardPrice: unknown }} entry
 * @returns {boolean}
 */
export function isCompleteProduct(entry) {
  return [entry.DEXProductName, entry.CashPrice, entry.CreditCardPrice].every(
    hasValue,
  );
}

/**
 * The catalog product for a drink.
 * @param {ReturnType<typeof buildNayaxCatalog>} catalog
 * @param {DrinkParts} drink
 * @returns {{ NayaxProductID: unknown, DEXProductName: unknown, CashPrice: unknown, CreditCardPrice: unknown }}
 * @throws {RestockError} 400 unknownProduct or incompleteProduct when Nayax has no usable product
 */
export function lookupProduct(catalog, drink) {
  const entry = catalog.get(canonicalDrinkKeyFromParts(drink));
  if (!entry)
    throw new RestockError(ERRORS.unknownProduct(formatDrinkName(drink)));
  if (!isCompleteProduct(entry))
    throw new RestockError(ERRORS.incompleteProduct(formatDrinkName(drink)));
  return entry;
}

/**
 * Machine products to create: slots on the plan that Nayax does not have yet.
 * Nayax ignores missing stock on create; the PUT that follows sets it.
 * @param {{ currentProducts: object[], catalog: ReturnType<typeof buildNayaxCatalog>, slots: { slotNumber: number, drink: DrinkParts | null, total: number }[] }} input
 *   currentProducts as read from Nayax; slots is what each slot should hold after the visit
 * @returns {object[]}
 * @throws {RestockError} via lookupProduct when a drink has no usable Nayax product
 */
export function nayaxSlotsToCreate({ currentProducts, catalog, slots }) {
  const existingSlots = new Set(currentProducts.map(getProductSlot));
  return slots
    .filter(({ slotNumber, drink }) => drink?.flavor && !existingSlots.has(slotNumber))
    .map(({ slotNumber, drink, total }) => ({
      ...lookupProduct(catalog, drink),
      MDBCode: slotNumber,
      PAR: total,
    }));
}

/**
 * The machine's whole product list for one full PUT: changed slots get
 * PAR = total and missing stock reset (Nayax's count is PAR minus missing
 * stock), emptied slots are left out, everything else is sent back as read.
 * @param {{ currentProducts: object[], catalog: ReturnType<typeof buildNayaxCatalog>, slots: { slotNumber: number, drink: DrinkParts | null, total: number }[] }} input
 *   currentProducts as read from Nayax, including any slots just created; slots is what each slot should hold after the visit
 * @returns {object[] | null} null when nothing differs
 * @throws {RestockError} via lookupProduct when a drink has no usable Nayax product
 */
export function buildNayaxUpdate({ currentProducts, catalog, slots }) {
  const submittedBySlot = new Map(slots.map((s) => [s.slotNumber, s]));
  let changed = false;
  const put = [];
  for (const current of currentProducts) {
    const submitted = submittedBySlot.get(getProductSlot(current));
    if (!submitted) {
      put.push(current);
      continue;
    }
    const { drink, total } = submitted;
    if (!drink?.flavor) {
      changed = true;
      continue;
    }
    if (sameDrink(drink, getProductName(current))) {
      // null missing stock means Nayax has no reading yet, not zero
      const missing = current.MissingStockByMDB;
      const unchanged =
        Number(current.PAR) === total &&
        missing != null &&
        Number(missing) === 0;
      if (unchanged) {
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
  return changed ? put : null;
}
