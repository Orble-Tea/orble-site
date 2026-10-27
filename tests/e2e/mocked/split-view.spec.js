// Browser tests for the kitchen's Split view: one read-only card per drink
// with the storage count and each machine's share.
import { test, expect } from "@playwright/test";
import { mockData, startLog } from "./helpers.mjs";

/** Canned Split payload: a drink on both machines, one on Towne only, one that stays in the fridge. */
export function splitPayload() {
  return {
    batchId: "Kitchen-2026-07-10",
    event: "Split",
    warnings: [],
    drinks: [
      {
        drink: "Mango Passion Fruit Tea 16oz",
        storage: 11,
        to30th: 6,
        toTowne: 5,
      },
      { drink: "Taro Tea 22oz Less Sweet", storage: 3, to30th: 0, toTowne: 2 },
      { drink: "Horchata 16oz", storage: 5, to30th: 0, toTowne: 0 },
    ],
  };
}

test("a Split date opens the kitchen view with a card per drink", async ({
  page,
}) => {
  await mockData(page, splitPayload());
  await startLog(page, "2026-07-10");

  await expect(page.locator("#view-split")).toBeVisible();
  await expect(page.locator("#view-table")).toBeHidden();
  await expect(page.locator("#split-event")).toHaveText("Split");
  await expect(page.locator("#split-date")).toHaveText("2026-07-10");
  await expect(page.locator("#split-title")).toHaveText("Kitchen");

  const cards = page.locator("[data-drink]");
  await expect(cards).toHaveCount(3);

  const mango = page.locator('[data-drink="Mango Passion Fruit Tea 16oz"]');
  await expect(mango.locator(".text-base.font-semibold").first()).toHaveText(
    "Mango Passion Fruit Tea",
  );
  await expect(mango.locator(".text-xs")).toHaveText(["16oz"]);
  await expect(mango.locator("[data-storage]")).toHaveText("11");
  await expect(mango.locator('[data-to="30th"]')).toHaveText("6");
  await expect(mango.locator('[data-to="Towne"]')).toHaveText("5");

  const horchata = page.locator('[data-drink="Horchata 16oz"]');
  await expect(horchata.locator('[data-to="30th"]')).toHaveText("0");
  await expect(horchata.locator('[data-to="Towne"]')).toHaveText("0");
});
