// Shared fixtures for the restock lib tests: request slots, Nayax products,
// and two drinks used throughout.

/**
 * A submitted slot in the POST shape: the full state the restocker
 * confirmed. `drink` is the parts going in (null = Empty); `previousDrink`
 * is what was physically in the slot (null = was empty).
 */
export function submitted(overrides) {
  return {
    slot: 1,
    drink: null,
    previousDrink: null,
    previous: 0,
    waste: 0,
    new: 0,
    ...overrides,
  };
}

/** The prefill a slot started from, in the POST's `expected` shape. */
export function expected(overrides) {
  return {
    drink: null,
    previousDrink: null,
    previous: 0,
    waste: 0,
    new: 0,
    ...overrides,
  };
}

/** A Nayax machine product as GET /machineProducts returns it. */
export function product(overrides) {
  return {
    MachineProductID: "mp-1",
    NayaxProductID: 1001,
    MachineID: 9999,
    MDBCode: 1,
    PAR: 4,
    MissingStockByMDB: 1,
    DEXProductName: "THAI_16_LESS_LYC",
    CashPrice: 6.5,
    CreditCardPrice: 6.5,
    RetailPrice: 6.5,
    ...overrides,
  };
}

export const THAI = {
  flavor: "Thai Tea",
  size: "16oz",
  sweetness: "Less Sweet",
  topping: "Lychee",
};
export const MATCHA = {
  flavor: "Matcha",
  size: "16oz",
  sweetness: "Less Sweet",
};

/** A Nayax catalog product as GET /operators/{id}/products returns it. */
export function catalogProduct(overrides) {
  return {
    NayaxProductID: 2002,
    ProductName: "Matcha 16oz Less Sweet",
    DEXProductName: "MATC_16_LESS",
    ProductCashPrice: 7,
    ProductCreditCardPrice: 7.25,
    ProductStatus: 1,
    ...overrides,
  };
}
