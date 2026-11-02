// Renders the screenshots docs/ORBLE_BETA.md embeds, from the real page with
// a mocked API. Run with `npm run docs:screens`; excluded from the test projects.
import { test, expect } from "@playwright/test";
import {
  approveAll,
  mockData,
  mockSubmit,
  slot,
  startLog,
} from "../mocked/helpers.mjs";
import { parseDrinkName } from "../../../src/lib/restock/drink-parsing.js";

const OUT = "docs/batch-journey";
const DATE = "2026-07-10";

/** A slot keeping the drink it already holds, so the table shows no "replacing". */
function sameDrinkSlot(slotNumber, name, counts) {
  const parts = parseDrinkName(name);
  return slot({
    slotNumber,
    previousDrink: name,
    flavor: parts.flavor,
    size: parts.size,
    topping: parts.topping || null,
    sweetness: parts.sweetness || null,
    ...counts,
  });
}

/** Load payload with one of each card state the doc describes. */
function loadPayload() {
  return {
    batchId: `30th-${DATE}`,
    event: "Load",
    machine: "30th",
    date: DATE,
    slots: [
      sameDrinkSlot(1, "Thai Tea 16oz Less Sweet w/ Lychee", {
        previous: 3,
        waste: 3,
        expectedNew: 3,
        total: 3,
      }),
      sameDrinkSlot(2, "Taro Tea 22oz", {
        previous: 3,
        waste: 3,
        expectedNew: 3,
        total: 3,
      }),
      slot({
        slotNumber: 3,
        previousDrink: "Matcha 22oz",
        flavor: "Mango Passion Fruit Tea",
        size: "16oz",
        previous: 1,
        waste: 1,
        expectedNew: 4,
        total: 4,
      }),
      sameDrinkSlot(4, "Black Tea 16oz Less Sweet", {
        previous: 2,
        waste: 2,
        expectedNew: 4,
        total: 4,
      }),
      slot({
        slotNumber: 5,
        previousDrink: "BMT22",
        previous: 3,
        waste: 3,
        expectedNew: 4,
        total: 4,
      }),
      slot({ slotNumber: 6 }),
    ],
    warnings: [
      {
        slot: 5,
        code: "UNPARSED_NAYAX_PRODUCT_NAME",
        reason: 'unrecognized "BMT22", missing flavor, missing or invalid size',
      },
    ],
  };
}

test("day1-start: machine and batch date", async ({ page }) => {
  await mockData(page, loadPayload());
  await page.goto("/restock?key=test-key");
  await page.fill("#batch-date", DATE);
  await page.locator("#batch-date").blur();
  await page
    .locator("#view-start")
    .screenshot({ path: `${OUT}/day1-start.png` });
});

test("day1-load-table: approved, same drink, replacing, edited, unrecognized, empty", async ({
  page,
}) => {
  await mockData(page, loadPayload());
  await startLog(page, DATE);
  await page.locator("[data-approve]").first().waitFor();
  await page.locator('[data-approve="0"]').check();
  await page.setViewportSize({ width: 390, height: 1180 });
  const edit = page.locator('[data-slot="4"] [data-edit]');
  await edit.scrollIntoViewIfNeeded();
  await edit.click({ force: true });
  await expect(page.locator("#edit-body")).toBeVisible();
  await page.locator('#edit-body [data-step="newCount:-1"]').click();
  await page.click("#edit-save");
  await expect(page.locator('[data-slot="4"]')).toContainText("(edited)");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/day1-load-table.png` });
});

test("day1-edit-slot: replacing strip, drink pickers, steppers", async ({
  page,
}) => {
  await mockData(page, loadPayload());
  await startLog(page, DATE);
  await page.locator("[data-approve]").first().waitFor();
  const edit = page.locator('[data-slot="3"] [data-edit]');
  await edit.scrollIntoViewIfNeeded();
  await edit.click({ force: true });
  await expect(page.locator("#edit-body")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 860 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/day1-edit-slot.png` });
});

test("day1-edit-unrecognized: nothing preselected, counts from Nayax", async ({
  page,
}) => {
  await mockData(page, loadPayload());
  await startLog(page, DATE);
  await page.locator("[data-approve]").first().waitFor();
  const edit = page.locator('[data-slot="5"] [data-edit]');
  await edit.scrollIntoViewIfNeeded();
  await edit.click({ force: true });
  await expect(page.locator("#edit-body")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 960 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/day1-edit-unrecognized.png` });
});

/** Split payload: a drink on both machines, one on Towne only, one that stays in the fridge. */
function splitPayload() {
  return {
    batchId: `Kitchen-${DATE}`,
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

/** Topoff payload: occupied slots keep their drink, waste 0, new from the split. */
function topoffPayload() {
  return {
    batchId: `30th-${DATE}`,
    event: "Topoff",
    machine: "30th",
    date: DATE,
    warnings: [],
    slots: [
      sameDrinkSlot(1, "Thai Tea 16oz Less Sweet w/ Lychee", {
        previous: 3,
        waste: 0,
        expectedNew: 1,
        total: 4,
      }),
      sameDrinkSlot(2, "Taro Tea 22oz", {
        previous: 1,
        waste: 0,
        expectedNew: 2,
        total: 3,
      }),
      sameDrinkSlot(3, "Mango Passion Fruit Tea 16oz", {
        previous: 2,
        waste: 0,
        expectedNew: 2,
        total: 4,
      }),
      slot({ slotNumber: 4 }),
    ],
  };
}

test("day3-split-form: storage and each machine's split per drink", async ({
  page,
}) => {
  await mockData(page, splitPayload());
  await startLog(page, DATE);
  await expect(page.locator("#view-split")).toBeVisible();
  await page.screenshot({ path: `${OUT}/day3-split-form.png` });
});

test("day3-split-submitted: confirmation after Complete", async ({ page }) => {
  await mockData(page, splitPayload());
  await mockSubmit(page);
  await startLog(page, DATE);
  await expect(page.locator("#view-split")).toBeVisible();
  await approveAll(page);
  await page.click("#split-complete");
  await expect(page.locator("#view-submitted")).toBeVisible();
  await page.screenshot({ path: `${OUT}/day3-split-submitted.png` });
});

test("day3-topoff-table: previous count shown, waste 0, new from the split", async ({
  page,
}) => {
  await mockData(page, topoffPayload());
  await startLog(page, DATE);
  await page.locator("[data-approve]").first().waitFor();
  await page.screenshot({ path: `${OUT}/day3-topoff-table.png` });
});
