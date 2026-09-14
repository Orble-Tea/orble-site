// This spec outlines integration tests between the UI and the backend that call our API routes and services
import { test, expect } from "@playwright/test";
import { SCENARIO_DATES } from "../fixture-server.mjs";

const KEY = "test-key";

/** The slot's card element, located by slot number instead of DOM order. */
function slotCard(page, n) {
  return page.locator(`[data-slot="${n}"]`);
}

async function startLog(page, date) {
  await page.goto(`/restock?key=${KEY}`);
  await page.fill("#batch-date", date);
  await page.click("#start-log");
}

test("Load: real service output renders (field-name contract)", async ({
  page,
}) => {
  await startLog(page, SCENARIO_DATES.load);
  await expect(page.locator("#table-event")).toHaveText("Load");

  // Slot 1: plan assigns 3x Matcha, Nayax says 3 Thai Tea in the slot
  // (PAR 4 - missing 1). The page must render the service's expectedNew /
  // sweetnessLevel / previousDrink fields, not the spec-doc names.
  const slot1 = slotCard(page, 1);
  await expect(slot1).toContainText("Matcha");
  await expect(slot1).toContainText(
    "replacing Thai Tea 16oz Less Sugar w/ Lychee",
  );
  await expect(slot1).toContainText("new: 3");
  await expect(slot1).toContainText("waste: 3");
  await expect(slot1).toContainText("Less Sugar"); // sweetnessLevel reached the qualifiers

  // Slot 3: Nayax reports an unparseable product name -> warnings[] flows
  // through the real route and lands on the row.
  const slot3 = slotCard(page, 3);
  await expect(slot3).toContainText(/unrecognized flavor code/i);

  // Slot 4 has drinks but no plan row: the real service leaves flavor null
  // (zero-quantity/unplanned contract) and the page renders the retiring
  // instruction, never the old drink as if it were incoming.
  const slot4 = slotCard(page, 4);
  await expect(slot4).toContainText("Empty");
  await expect(slot4).toContainText("removing Taro 16oz");
  await expect(slot4).toContainText("waste: 2");

  // Slot 5 has no product and no plan row: the truly-empty card.
  await expect(slotCard(page, 5)).toContainText("Empty");
});

test("Topoff: real allocation and previous counts flow through", async ({
  page,
}) => {
  await startLog(page, SCENARIO_DATES.topoff);
  await expect(page.locator("#table-event")).toHaveText("Topoff");

  // Real determineEvent read the fixture Restock Log's Load row for this
  // batch. Inventory allocates from "To 30th"; slot 1 keeps its drink.
  const slot1 = slotCard(page, 1);
  await expect(slot1).toContainText("previous: 3");
  await expect(slot1).toContainText("waste: 0");
  await expect(slot1).not.toContainText("replacing");
});

test("fully-logged batch: real 409 fires the terminal error card", async ({
  page,
}) => {
  await startLog(page, SCENARIO_DATES.done);
  await expect(page.locator("#start-status")).toContainText(
    /already loaded and topped off/i,
  );
  await expect(page.locator("#view-table")).toBeHidden();
});

test("submit: stub endpoint accepts the page's real POST", async ({ page }) => {
  await startLog(page, SCENARIO_DATES.load);
  await expect(page.locator("#table-event")).toHaveText("Load");
  for (const box of await page.locator("[data-approve]").all()) {
    await box.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await box.check();
  }
  await page.click("#complete");
  // Real route validated key + required fields and acknowledged.
  await expect(page.locator("#view-submitted")).toBeVisible();
});
