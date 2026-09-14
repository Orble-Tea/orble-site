// @steered AudibleSecurityContext 1.2 2026-09-14
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

  // Edit slot 1: math updates live and waste is capped at previous.
  await page.locator("[data-edit]").first().click();
  await page.locator('[data-step="newCount:1"]').click(); // new 3 -> 4
  await expect(page.locator("#edit-total")).toHaveText("4"); // 3 - 3 + 4
  await page.locator('[data-step="waste:1"]').click(); // waste already at previous(3): capped
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
  expect(body.batchId).toBe("30TH-2026-07-10");
  expect(body.event).toBe("Load");
  expect(body.machine).toBe("30TH");
  expect(body.date).toBe("2026-07-10");
  expect(body.duration).toMatch(/^\d+m \d+s$/);
  // Empty slot 4 is excluded; the retiring slot's waste IS recorded;
  // the edited value made it through.
  expect(body.slots).toEqual([
    { slot: 1, waste: 3, new: 4 },
    { slot: 2, waste: 2, new: 2 },
    { slot: 3, waste: 2, new: 0 },
  ]);
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

  // The New stepper is zeroed and locked too: nothing goes into a cleared slot.
  await expect(page.locator('[data-step="newCount:1"]')).toBeDisabled();
  await expect(page.locator("#edit-newCount")).toHaveText("0");

  // Picking a real flavor re-enables everything.
  await page.selectOption("#edit-flavor", { index: 0 });
  await expect(page.locator("#edit-chips input").first()).toBeEnabled();
  await expect(page.locator('[data-step="newCount:1"]')).toBeEnabled();
});
