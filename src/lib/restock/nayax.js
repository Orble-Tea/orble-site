import { assertConfigured, NAYAX_BASE_URL } from "./config.js";

async function nayaxFetch(path, options = {}) {
  const token = assertConfigured(process.env.NAYAX_API_TOKEN, "NAYAX_API_TOKEN");
  const response = await fetch(`${NAYAX_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Nayax request failed: ${await response.text()}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function getMachineProducts(machineId) {
  const payload = await nayaxFetch(`/machines/${machineId}/machineProducts`);
  return Array.isArray(payload) ? payload : payload?.data || payload?.items || [];
}

export async function updateMachineProducts(machineId, products) {
  return nayaxFetch(`/machines/${machineId}/machineProducts?avoidDelete=true`, {
    method: "PUT",
    body: JSON.stringify(products),
  });
}

export async function createMachineProducts(machineId, products) {
  if (!products.length) return null;
  return nayaxFetch(`/machines/${machineId}/machineProducts`, {
    method: "POST",
    body: JSON.stringify(products),
  });
}

export function getProductSlot(product) {
  return Number(product.MDBCode ?? product.mdbCode ?? product.slot);
}

export function getProductPar(product) {
  return Number(product.PAR ?? product.par ?? 0) || 0;
}

export function getProductName(product) {
  return String(product.DEXProductName ?? product.dexProductName ?? "").trim();
}

export function getMachineProductId(product) {
  return product.MachineProductID ?? product.machineProductId;
}

export function getNayaxProductId(product) {
  return product.NayaxProductID ?? product.nayaxProductId;
}
