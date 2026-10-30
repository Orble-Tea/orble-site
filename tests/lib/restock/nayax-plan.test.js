// Unit tests for the Nayax write plan: the catalog, which slots to create and
// the machine products PUT.
import { describe, expect, it } from "vitest";
import {
  buildNayaxCatalog,
  buildNayaxUpdate,
  nayaxSlotsToCreate,
} from "../../../src/lib/restock/nayax-plan.js";
import { MATCHA, THAI, catalogProduct, product } from "./fixtures.js";

describe("buildNayaxUpdate", () => {
  // The catalog decides which product a drink is. DEX name and prices come
  // from a machine slot already using that product, else from the catalog.
  const catalog = buildNayaxCatalog(
    [
      catalogProduct(),
      catalogProduct({
        NayaxProductID: 1001,
        ProductName: "Thai Tea 16oz Less Sweet w/ Lychee",
        DEXProductName: null,
        ProductCashPrice: null,
        ProductCreditCardPrice: null,
      }),
      catalogProduct({
        NayaxProductID: 4004,
        ProductName: "Strawberry Matcha 16oz",
        DEXProductName: "SMAT_16",
        ProductCashPrice: 6.25,
        ProductCreditCardPrice: 6.25,
      }),
      catalogProduct({
        NayaxProductID: 6006,
        ProductName: "Taro Tea 16oz",
        ProductStatus: 0,
      }),
      catalogProduct({
        NayaxProductID: 7007,
        ProductName: "Black Tea 16oz",
        DEXProductName: null,
        ProductCashPrice: null,
        ProductCreditCardPrice: null,
      }),
    ],
    // Another machine's slot already carries the Thai Tea product, with the
    // DEX name and prices the catalog entry lacks.
    [
      product({
        MachineProductID: "other-8",
        NayaxProductID: 1001,
        MDBCode: 8,
        DEXProductName: "THAI_16_LESS_LYC",
        CashPrice: 6.5,
        CreditCardPrice: 6.5,
      }),
    ],
  );

  it("sends the whole machine in one PUT, with PAR = total and missing stock reset on changed slots", () => {
    const changed = product({
      MachineProductID: "mp-1",
      MDBCode: 1,
      PAR: 4,
      MissingStockByMDB: 2,
    });
    const untouched = product({
      MachineProductID: "mp-2",
      MDBCode: 2,
      PAR: 4,
      MissingStockByMDB: 1,
    });
    const outsideConfig = product({ MachineProductID: "mp-60", MDBCode: 60 });
    const put = buildNayaxUpdate({
      currentProducts: [changed, untouched, outsideConfig],
      catalog,
      slots: [{ slotNumber: 1, drink: THAI, total: 4 }],
    });
    // Full objects: a PUT replaces each product and drops anything left out
    expect(put).toEqual([
      { ...changed, PAR: 4, MissingStockByMDB: 0 },
      untouched,
      outsideConfig,
    ]);
  });

  it("skips the PUT when nothing differs", () => {
    const current = [product({ PAR: 3, MissingStockByMDB: 0 })];
    const put = buildNayaxUpdate({
      currentProducts: current,
      catalog,
      slots: [{ slotNumber: 1, drink: THAI, total: 3 }],
    });
    expect(put).toBeNull();
  });

  it("swaps the product ID, DEX name, and prices from the catalog when the drink changes", () => {
    const current = [product({ MDBCode: 1 })];
    const put = buildNayaxUpdate({
      currentProducts: current,
      catalog,
      slots: [{ slotNumber: 1, drink: MATCHA, total: 4 }],
    });
    expect(put).toEqual([
      {
        ...current[0],
        NayaxProductID: 2002,
        DEXProductName: "MATC_16_LESS",
        CashPrice: 7,
        CreditCardPrice: 7.25,
        PAR: 4,
        MissingStockByMDB: 0,
      },
    ]);
  });

  it("creates a machine product for a slot Nayax does not have", () => {
    const created = nayaxSlotsToCreate({
      currentProducts: [],
      catalog,
      slots: [{ slotNumber: 50, drink: MATCHA, total: 3 }],
    });
    expect(created).toEqual([
      {
        NayaxProductID: 2002,
        MDBCode: 50,
        PAR: 3,
        DEXProductName: "MATC_16_LESS",
        CashPrice: 7,
        CreditCardPrice: 7.25,
      },
    ]);
  });

  it("leaves an emptied slot out of the PUT and keeps every other product", () => {
    const keep = product({
      MachineProductID: "mp-2",
      MDBCode: 2,
      PAR: 4,
      MissingStockByMDB: 1,
    });
    const outsideConfig = product({ MachineProductID: "mp-60", MDBCode: 60 });
    const emptied = product({ MachineProductID: "mp-1", MDBCode: 1 });
    const put = buildNayaxUpdate({
      currentProducts: [emptied, keep, outsideConfig],
      catalog,
      slots: [
        { slotNumber: 1, drink: null, total: 0 },
        { slotNumber: 2, drink: THAI, total: 4 },
      ],
    });
    expect(put).toEqual([
      { ...keep, PAR: 4, MissingStockByMDB: 0 },
      outsideConfig,
    ]);
  });

  const create = (drink) =>
    nayaxSlotsToCreate({
      currentProducts: [],
      catalog,
      slots: [{ slotNumber: 50, drink, total: 2 }],
    })[0];

  it("takes DEX name and prices from a slot already using the product when the catalog lacks them", () => {
    expect(create(THAI)).toMatchObject({
      NayaxProductID: 1001,
      DEXProductName: "THAI_16_LESS_LYC",
      CashPrice: 6.5,
      CreditCardPrice: 6.5,
    });
  });

  it("creates a drink that is in the catalog but in no machine slot", () => {
    expect(
      create({ flavor: "Matcha", size: "16oz", topping: "Strawberry" }),
    ).toMatchObject({
      NayaxProductID: 4004,
      DEXProductName: "SMAT_16",
      CashPrice: 6.25,
      CreditCardPrice: 6.25,
    });
  });

  it("ignores inactive catalog products", () => {
    expect(() => create({ flavor: "Taro Tea", size: "16oz" })).toThrow(
      /'Taro Tea 16oz Regular Sweetness' is not an active Nayax product/i,
    );
  });

  it("refuses a drink that is not in the catalog", () => {
    expect(() => create({ flavor: "Viet Latte", size: "16oz" })).toThrow(
      /'Viet Latte 16oz Regular Sweetness' is not an active Nayax product/i,
    );
  });

  it("refuses a product with no DEX name or prices anywhere", () => {
    expect(() => create({ flavor: "Black Tea", size: "16oz" })).toThrow(
      /'Black Tea 16oz Regular Sweetness' has no DEX name or prices in Nayax/i,
    );
  });
});
