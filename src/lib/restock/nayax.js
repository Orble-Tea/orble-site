import { assertConfigured, NAYAX_BASE_URL } from "./config.js";
import { UpstreamServiceError } from "./errors.js";

async function nayaxFetch(
  path,
  options = {},
  operation = "get_machine_products",
) {
  const token = assertConfigured(
    process.env.NAYAX_API_TOKEN,
    "NAYAX_API_TOKEN",
  );
  const response = await fetch(`${NAYAX_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new UpstreamServiceError("Invalid NAYAX_API_TOKEN", {
        service: "nayax",
        operation,
        status: response.status,
      });
    }
    if (response.status === 403) {
      throw new UpstreamServiceError("NAYAX_API_TOKEN is not authorized", {
        service: "nayax",
        operation,
        status: response.status,
      });
    }
    throw new UpstreamServiceError(
      `Nayax request failed with status ${response.status}`,
      {
        service: "nayax",
        operation,
        status: response.status,
      },
    );
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function getMachineProducts(machineId) {
  const payload = await nayaxFetch(`/machines/${machineId}/machineProducts`);
  return Array.isArray(payload)
    ? payload
    : payload?.data || payload?.items || [];
}

/** One machine's record; carries the operator ID the catalog is keyed by. */
export async function getMachine(machineId) {
  const payload = await nayaxFetch(`/machines/${machineId}`, {}, "get_machine");
  return Array.isArray(payload) ? payload[0] : payload;
}

/** The operator's product catalog: every product that can go in a slot. */
export async function getOperatorProducts(operatorId) {
  const payload = await nayaxFetch(
    `/operators/${operatorId}/products`,
    {},
    "get_operator_products",
  );
  return Array.isArray(payload) ? payload : payload?.data || [];
}

/**
 * Writes machine products. With avoidDelete the listed products are
 * updated in place; without it Nayax replaces the machine's whole list and
 * drops anything left out, which is the only way to remove a slot.
 */
export async function putMachineProducts(machineId, products, { avoidDelete }) {
  const query = avoidDelete ? "?avoidDelete=true" : "";
  return nayaxFetch(
    `/machines/${machineId}/machineProducts${query}`,
    { method: "PUT", body: JSON.stringify(products) },
    "put_machine_products",
  );
}

/** Creates machine products for slots Nayax does not have yet; returns the created records. */
export async function createMachineProducts(machineId, products) {
  const payload = await nayaxFetch(
    `/machines/${machineId}/machineProducts`,
    { method: "POST", body: JSON.stringify(products) },
    "create_machine_products",
  );
  return Array.isArray(payload)
    ? payload
    : payload?.data || payload?.items || [];
}

export function getProductSlot(product) {
  return Number(
    product.MDBCode ??
      product.mdbCode ??
      product.Pick ??
      product.pick ??
      product.PickNumber ??
      product.pickNumber ??
      product["Pick Number"] ??
      product["pick number"] ??
      product.slot,
  );
}

function readNumberField(product, fields) {
  for (const field of fields) {
    const value = product[field];
    if (value === null || typeof value === "undefined" || value === "")
      continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}

const MISSING_STOCK_FIELDS = [
  "MissingStockByMDB",
  "MissingStockByDEX",
  "missingStockByMDB",
  "missingStockByDEX",
];

export function getProductPar(product) {
  return Number(product.PAR ?? product.par ?? 0) || 0;
}

export function getProductOnHand(product) {
  const par = getProductPar(product);
  const missingStock = readNumberField(product, MISSING_STOCK_FIELDS);
  if (par > 0 && missingStock !== null) return Math.max(par - missingStock, 0);

  return 0;
}

export function hasProductOnHand(product) {
  return (
    getProductPar(product) > 0 &&
    readNumberField(product, MISSING_STOCK_FIELDS) !== null
  );
}

export function getProductName(product) {
  return String(product.DEXProductName ?? product.dexProductName ?? "").trim();
}
