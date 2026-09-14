// Layer 2: the page is real, the backend is faked at the network layer.
// One dense journey carries the tier: table shape, approve gate, fold, edit
// math, and the highest-value assertion in the suite: the exact POST body the
// follow-up submit PR will feed into Nayax and the Restock Log.
import { test, expect } from "@playwright/test";
import {
  loadPayload,
  topoffPayload,
  mockData,
  mockSubmit,
  startLog,
  approveAll,
  scrollAndClick,
  slot,
} from "./helpers.mjs";

test("full Load visit: render, gate, edit, fold, submit payload", async ({
  page,
}) => {
  await mockData(page, loadPayload());
  const posts = await mockSubmit(page);
  await startLog(page, "2026-07-10");

  // Table renders the Load work order.
  await expect(page.locator("#table-event")).toHaveText("Load");
  const slot1 = page.locator("#slot-list > div").first();
  await expect(slot1).toContainText("Matcha");
  await expect(slot1).toContainText(
    "replacing Thai Tea 16oz Less Sugar w/ Lychee",
  );
  await expect(slot1).toContainText("waste: 3");
  // Same-drink slot shows no replacing line; empty slot renders greyed.
  await expect(page.locator("#slot-list > div").nth(1)).not.toContainText(
    "replacing",
  );
  await expect(page.locator("#slot-list > div").nth(2)).toContainText("Empty");

  // Approve gate: Complete with nothing approved fires NO request.
  await page.click("#complete");
  await expect(page.locator("#complete-hint")).toContainText(
    "Not approved: slots 1, 2, 3",
  );
  expect(posts).toHaveLength(0);

  // Edit slot 1: math updates live and waste is NOT capped at previous.
  // On a Load, counting more waste than Nayax expected means Nayax
  // undercounted: previous tracks the waste up.
  await page.locator("[data-edit]").first().click();
  await page.locator('[data-step="newCount:1"]').click(); // new 3 -> 4
  await expect(page.locator("#edit-total")).toHaveText("4"); // 3 - 3 + 4
  await page.locator('[data-step="waste:1"]').click(); // waste 3 -> 4
  await expect(page.locator("#edit-m-prev")).toHaveText("4"); // previous follows
  await expect(page.locator("#edit-total")).toHaveText("4"); // 4 - 4 + 4
  await page.locator('[data-step="waste:-1"]').click(); // back to 3
  await expect(page.locator("#edit-m-prev")).toHaveText("3"); // and back down
  await expect(page.locator("#edit-m-waste")).toHaveText("3");
  await page.click("#edit-save");

  // Approving folds the row to a single line with the full drink name.
  await approveAll(page);
  await expect(page.locator("#slot-list > div").first()).toContainText(
    "16oz Matcha Less Sugar with Lychee",
  );

  // Complete now submits; the POST body is the contract.
  await page.click("#complete");
  await expect(page.locator("#view-submitted")).toBeVisible();
  expect(posts).toHaveLength(1);
  const body = posts[0];
  expect(body.batchId).toBe("30th-2026-07-10");
  expect(body.event).toBe("Load");
  expect(body.machine).toBe("30th");
  expect(body.date).toBe("2026-07-10");
  expect(body.duration).toMatch(/^\d+m \d+s$/);
  // Every slot is reported, empties included; the retiring slot's waste
  // IS recorded; the edited value made it through.
  expect(body.slots).toEqual([
    { slot: 1, waste: 3, new: 4 },
    { slot: 2, waste: 2, new: 2 },
    { slot: 3, waste: 2, new: 0 },
    { slot: 4, waste: 0, new: 0 },
  ]);
});

test("Topoff over-waste: previous amends to match waste", async ({
  page,
}) => {
  await mockData(page, topoffPayload());
  await startLog(page, "2026-07-13");
  await scrollAndClick(page.locator("[data-edit]").first());
  // Nayax says previous 3; waste past it must raise the shown previous.
  for (let i = 0; i < 4; i++) await page.click('[data-step="waste:1"]');
  await expect(page.locator("#edit-m-prev")).toHaveText("4");
  await page.click("#edit-save");
  const slot1 = page.locator("#slot-list > div").first();
  await expect(slot1).toContainText("previous: 4");
  await expect(slot1).toContainText("waste: 4");
  await expect(slot1).toContainText("total: 2");
});

test("sold-out slot renders Empty with the sold out! note", async ({
  page,
}) => {
  const payload = topoffPayload();
  // Drink configured in Nayax, sold through, nothing allocated to add.
  payload.slots.push(
    slot({ slot: 9, flavor: "Taro", size: "16oz", previous: 0 }),
  );
  await mockData(page, payload);
  await startLog(page, "2026-07-13");
  const card = page.locator("#slot-list > div").last();
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
  const slot1 = page.locator("#slot-list > div").first();
  await expect(slot1).toContainText("previous: 3");
  await expect(slot1).toContainText("waste: 0");
  await expect(slot1).toContainText("total: 5");
  await expect(slot1).not.toContainText("replacing");
  // Topoff order: previous, waste, new, total (total always last).
  await expect(slot1.locator(".text-right")).toHaveText(
    /previous:.*waste:.*new:.*total:/s,
  );
});

test("edit on a retiring slot: Empty preselected, chips greyed until a flavor is picked", async ({
  page,
}) => {
  await mockData(page, loadPayload());
  await startLog(page, "2026-07-10");
  await scrollAndClick(page.locator("[data-edit]").nth(2)); // slot 3, the retiring one

  // The strip says removing (not replacing), Empty is the selected flavor,
  // and the drink attribute chips are disabled: nothing is going in.
  await expect(page.locator("#edit-body")).toContainText("removing Taro 16oz");
  await expect(page.locator("#edit-flavor")).toHaveValue("__empty__");
  await expect(page.locator("#edit-chips input").first()).toBeDisabled();

  // Nothing renders green while Empty is selected: the checked-chip case
  // is covered in the next test. The removing strip keeps its mint tint
  // by design.

  // The New stepper is zeroed and locked too: nothing goes into a cleared slot.
  await expect(page.locator('[data-step="newCount:1"]')).toBeDisabled();
  await expect(page.locator("#edit-newCount")).toHaveText("0");

  // Picking a real flavor re-enables everything.
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
  await expect(page.locator("#slot-list > div").first()).toHaveClass(
    /border-red-400/,
  );
  await approveAll(page);
  await page.click("#complete");
  await expect(page.locator("#view-submitted")).toBeVisible();

  // Back to the start view (the path that skipped the New log reset),
  // then start a brand-new date: no red rings, no banner.
  await page.goBack();
  await expect(page.locator("#view-start")).toBeVisible();
  await page.fill("#batch-date", "2026-07-11");
  await page.getByText("Start log").click();
  await expect(page.locator("#slot-list > div").first()).toBeVisible();
  await expect(page.locator("#slot-list > div").first()).not.toHaveClass(
    /border-red-400/,
  );
  await expect(page.locator("#approve-banner")).toBeHidden();
});

test("selecting Empty on a normal slot strips the checked chip's mint tint", async ({
  page,
}) => {
  await mockData(page, loadPayload());
  await startLog(page, "2026-07-10");
  await scrollAndClick(page.locator("[data-edit]").nth(1)); // slot 2, normal

  const checkedChip = page.locator("#edit-chips input:checked + div").first();
  await expect(checkedChip).toHaveCSS("background-color", "rgb(234, 246, 242)");

  await page.selectOption("#edit-flavor", "__empty__");
  await expect(checkedChip).toHaveCSS("background-color", "rgb(243, 244, 246)");

  // Picking the flavor back restores the mint tint.
  await page.selectOption("#edit-flavor", { index: 0 });
  await expect(checkedChip).not.toHaveCSS(
    "background-color",
    "rgb(243, 244, 246)",
  );
});
