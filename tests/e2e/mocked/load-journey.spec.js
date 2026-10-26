// Browser tests: the page is real, the backend is faked at the network layer.
import { test, expect } from "@playwright/test";
import {
  loadPayload,
  mockData,
  mockSubmit,
  startLog,
  approveAll,
  slot,
  CHIP_COLORS,
  slotCard,
} from "./helpers.mjs";

/** Canned Topoff payload with one restocked slot and one empty slot. */
function topoffPayload() {
  return {
    batchId: "30th-2026-07-13",
    event: "Topoff",
    warnings: [],
    slots: [
      slot({
        slotNumber: 1,
        previousDrink: "Thai Tea 16oz Less Sweet w/ Lychee",
        flavor: "Thai Tea",
        size: "16oz",
        topping: "Lychee",
        sweetness: "Less Sweet",
        previous: 3,
        waste: 0,
        expectedNew: 2,
        total: 5,
      }),
      slot({ slotNumber: 2 }),
    ],
  };
}

/** Scrolls an element clear of the fixed footer, then clicks it. */
async function scrollAndClick(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await locator.click();
}

test("full Load visit: render, gate, edit, fold, submit payload", async ({
  page,
}) => {
  await mockData(page, loadPayload());
  const posts = await mockSubmit(page);
  await startLog(page, "2026-07-10");

  // Table renders the Load work order.
  await expect(page.locator("#table-event")).toHaveText("Load");
  const slot1 = slotCard(page, 1);
  await expect(slot1).toContainText("Matcha");
  await expect(slot1).toContainText(
    "replacing Thai Tea 16oz Less Sweet w/ Lychee",
  );
  await expect(slot1).toContainText("waste: 3");
  // Same-drink slot shows no replacing line; empty slot renders greyed.
  await expect(slotCard(page, 2)).not.toContainText("replacing");
  await expect(slotCard(page, 3)).toContainText("Empty");

  // Approve gate: Complete with nothing approved fires NO request.
  await page.click("#complete");
  await expect(page.locator("#complete-hint")).toContainText(
    "Not approved: slots 1, 2, 3",
  );
  expect(posts).toHaveLength(0);

  // Edit slot 1: a stepper tap re-renders the total.
  await page.locator("[data-edit]").first().click();
  await page.locator('[data-step="newCount:1"]').click(); // new 3 -> 4
  await expect(page.locator("#edit-total")).toHaveText("4");
  // Drop the Lychee: a changed drink must reach the POST.
  await page
    .locator('#edit-chips label:has(input[name="Topping"][value="None"])')
    .click();
  await page.click("#edit-save");

  // Approving folds the row to a single line with the full drink name.
  await approveAll(page);
  await expect(slotCard(page, 1)).toContainText("16oz Matcha Less Sweet");

  // Complete now submits. The slot shape is toSubmitSlot's (unit tested);
  // here only what the page wires: the envelope, every slot, the edit, and the prefill next to it.
  await page.click("#complete");
  await expect(page.locator("#view-submitted")).toBeVisible();
  expect(posts).toHaveLength(1);
  const body = posts[0];
  expect(body.batchId).toBe("30th-2026-07-10");
  expect(body.event).toBe("Load");
  expect(body.duration).toMatch(/^\d+m \d+s$/);
  expect(body.slots.map((s) => s.slotNumber)).toEqual([1, 2, 3, 4]);
  expect(body.slots[0]).toMatchObject({ new: 4, drink: { topping: null } });
  expect(body.slots[0].expected).toMatchObject({ new: 3, drink: { topping: "Lychee" } });
});

test("Topoff: the previous stepper corrects the Nayax count and reaches the POST", async ({
  page,
}) => {
  await mockData(page, topoffPayload());
  const posts = await mockSubmit(page);
  await startLog(page, "2026-07-13");
  await scrollAndClick(page.locator("[data-edit]").first());
  // Nayax says 3 in the slot; the restocker counts 2.
  await page.click('[data-step="previous:-1"]');
  await expect(page.locator("#edit-previous")).toHaveText("2");
  await expect(page.locator("#edit-m-prev")).toHaveText("2");
  await page.click("#edit-save");

  await approveAll(page);
  await page.click("#complete");
  await expect(page.locator("#view-submitted")).toBeVisible();
  // The corrected count is what the server gets, next to the Nayax count it started from.
  expect(posts[0].slots[0]).toMatchObject({ slotNumber: 1, previous: 2 });
  expect(posts[0].slots[0].expected).toMatchObject({ previous: 3 });
});

test("sold-out slot renders Empty with the sold out! note", async ({
  page,
}) => {
  const payload = topoffPayload();
  // Drink configured in Nayax, sold through, nothing allocated to add.
  payload.slots.push(
    slot({ slotNumber: 9, flavor: "Taro", size: "16oz", previous: 0 }),
  );
  await mockData(page, payload);
  await startLog(page, "2026-07-13");
  const card = slotCard(page, 9);
  await expect(card).toContainText("Empty");
  await expect(card).toContainText("sold out!");
  // Nothing to count, so no counts column on the card.
  await expect(card).not.toContainText("waste:");
});

test("Topoff renders previous line, zero waste, no replacing", async ({
  page,
}) => {
  await mockData(page, topoffPayload());
  await startLog(page, "2026-07-13");

  await expect(page.locator("#table-event")).toHaveText("Topoff");
  const slot1 = slotCard(page, 1);
  await expect(slot1).toContainText("previous: 3");
  await expect(slot1).toContainText("waste: 0");
  await expect(slot1).toContainText("total: 5");
  await expect(slot1).not.toContainText("replacing");
  // Topoff order: previous, waste, new, total (total always last).
  await expect(slot1.locator(".text-right")).toHaveText(
    /previous:.*waste:.*new:.*total:/s,
  );
});

test("edit on a retiring slotNumber: Empty preselected, chips greyed until a flavor is picked", async ({
  page,
}) => {
  await mockData(page, loadPayload());
  await startLog(page, "2026-07-10");
  await scrollAndClick(page.locator("[data-edit]").nth(2)); // slot 3, the retiring one

  await expect(page.locator("#edit-body")).toContainText("removing Taro Tea 16oz");
  await expect(page.locator("#edit-flavor")).toHaveValue("__empty__");
  await expect(page.locator("#edit-chips input").first()).toBeDisabled();

  await expect(page.locator('[data-step="newCount:1"]')).toBeDisabled();
  await expect(page.locator("#edit-newCount")).toHaveText("0");

  await page.selectOption("#edit-flavor", { index: 0 });
  await expect(page.locator("#edit-chips input").first()).toBeEnabled();
  await expect(page.locator('[data-step="newCount:1"]')).toBeEnabled();
});

test("blocked-submit red state does not carry into a freshly started log", async ({
  page,
}) => {
  await mockData(page, loadPayload());
  await mockSubmit(page);
  await startLog(page, "2026-07-10");

  // Trip the gate, then finish the visit properly.
  await page.click("#complete");
  await expect(slotCard(page, 1)).toHaveClass(/border-red-400/);
  await approveAll(page);
  await page.click("#complete");
  await expect(page.locator("#view-submitted")).toBeVisible();

  // Back to the start view (the path that skipped the New log reset),
  // then start a brand-new date: no red rings, no banner.
  await page.goBack();
  await expect(page.locator("#view-start")).toBeVisible();
  await page.fill("#batch-date", "2026-07-11");
  await page.getByText("Start log").click();
  await expect(slotCard(page, 1)).toBeVisible();
  await expect(slotCard(page, 1)).not.toHaveClass(/border-red-400/);
  await expect(page.locator("#approve-banner")).toBeHidden();
});

test("selecting Empty on a normal slot strips the checked chip's mint tint", async ({
  page,
}) => {
  await mockData(page, loadPayload());
  await startLog(page, "2026-07-10");
  await scrollAndClick(page.locator("[data-edit]").nth(1)); // slot 2, normal

  const checkedChip = page.locator("#edit-chips input:checked + div").first();
  await expect(checkedChip).toHaveCSS("background-color", CHIP_COLORS.mint);

  await page.selectOption("#edit-flavor", "__empty__");
  await expect(checkedChip).toHaveCSS("background-color", CHIP_COLORS.muted);

  // Picking the flavor back restores the mint tint.
  await page.selectOption("#edit-flavor", { index: 0 });
  await expect(checkedChip).not.toHaveCSS(
    "background-color",
    CHIP_COLORS.muted,
  );
});
