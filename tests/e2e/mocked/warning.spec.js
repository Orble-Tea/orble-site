// Browser tests for the unknown-Nayax-code warning flow: the amber slot,
// the defaults-preselected edit form, and flavor-only resolution.
import { test, expect } from "@playwright/test";
import { loadPayload, mockData, startLog, slot, slotCard } from "./helpers.mjs";

/** Load payload variant with an unparseable drink code in slot 2. */
function warningPayload() {
  const payload = loadPayload();
  payload.slots[1] = slot({
    slot: 2,
    previousDrink: "BMT22",
    previous: 3,
    waste: 3,
    expectedNew: 3,
  });
  payload.warnings = [{ slot: 2, code: "UNPARSEABLE_DRINK_NAME" }];
  return payload;
}

test("warning slot renders amber and cannot resolve without a flavor", async ({
  page,
}) => {
  await mockData(page, warningPayload());
  await startLog(page, "2026-07-10");

  const card = slotCard(page, 2);
  await expect(card).toContainText("?");
  await expect(card).toContainText(/unrecognized flavor code/i);

  // The edit form opens with no flavor picked and the defaults checked.
  await card.locator("[data-edit]").evaluate((el) => el.click());
  await expect(page.locator("#edit-flavor")).toHaveValue("");
  await expect(
    page.locator('#edit-chips input[name="Size"][value="16oz"]'),
  ).toBeChecked();
  await expect(
    page.locator('#edit-chips input[name="Topping"][value="None"]'),
  ).toBeChecked();
  await expect(
    page.locator('#edit-chips input[name="Sweetness"][value="Regular"]'),
  ).toBeChecked();

  // Saving without picking a flavor keeps the warning on the table.
  await page.click("#edit-save");
  await expect(card).toContainText(/unrecognized flavor code/i);
});

test("flavor-only save clears the warning and applies the visible defaults", async ({
  page,
}) => {
  await mockData(page, warningPayload());
  await startLog(page, "2026-07-10");

  const card = slotCard(page, 2);
  await card.locator("[data-edit]").evaluate((el) => el.click());
  await page.selectOption("#edit-flavor", "Matcha");
  await page.click("#edit-save");

  await expect(card).not.toContainText(/unrecognized flavor code/i);
  await expect(card).toContainText("Matcha");
  await expect(card).toContainText("16oz");
  await expect(card).toContainText("(edited)");
});
