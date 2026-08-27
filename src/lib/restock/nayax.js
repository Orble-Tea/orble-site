import { assertConfigured, NAYAX_BASE_URL } from "./config.js";
import { UpstreamServiceError } from "./errors.js";

async function nayaxFetch(path, options = {}) {
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
        operation: "get_machine_products",
        status: response.status,
      });
    }
    if (response.status === 403) {
      throw new UpstreamServiceError("NAYAX_API_TOKEN is not authorized", {
        service: "nayax",
        operation: "get_machine_products",
        status: response.status,
      });
    }
    throw new UpstreamServiceError(
      `Nayax request failed with status ${response.status}`,
      {
        service: "nayax",
        operation: "get_machine_products",
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

export async function updateMachineProducts(machineId, products) {
  return nayaxFetch(`/machines/${machineId}/machineProducts?avoidDelete=true`, {
    method: "PUT",
    body: JSON.stringify(products),
  });
}

export async function createMachineProducts(machineId, products) {
  return nayaxFetch(`/machines/${machineId}/machineProducts`, {
    method: "POST",
    body: JSON.stringify(products),
  });
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

export function getMachineProductId(product) {
  return (
    product.MachineProductID ??
    product.machineProductId ??
    product.machineProductID ??
    product.MachineProductId ??
    product.machine_product_id ??
    null
  );
}

export function getNayaxProductId(product) {
  return (
    product.NayaxProductID ??
    product.nayaxProductId ??
    product.nayaxProductID ??
    product.NayaxProductId ??
    product.ProductID ??
    product.productId ??
    product.productID ??
    product.product_id ??
    null
  );
}

export function getCashPrice(product) {
  return (
    product.CashPrice ?? product.cashPrice ?? product.Cash ?? product.cash ?? 0
  );
}

export function getCreditCardPrice(product) {
  return (
    product.CreditCardPrice ??
    product.creditCardPrice ??
    product.CreditPrice ??
    product.creditPrice ??
    product.Credit ??
    product.credit ??
    getCashPrice(product)
  );
}
