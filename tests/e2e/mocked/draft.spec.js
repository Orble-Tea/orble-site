// Layer 2: the screen-goes-dark promise. Edits, approvals, and edited flags
// must survive a reload mid-visit, and the draft must vanish after a
// successful submit so the next visit starts clean.
import { test, expect } from "@playwright/test";
import {
  loadPayload,
  mockData,
  mockSubmit,
  startLog,
  approveAll,
} from "./helpers.mjs";

test("draft survives reload and clears after submit", async ({ page }) => {
  await mockData(page, loadPayload());
  const posts = await mockSubmit(page);
  await startLog(page, "2026-07-10");

  // Make work worth preserving: edit slot 1's new count, approve slot 2.
  await page.locator("[data-edit]").first().click();
  await page.locator('[data-step="newCount:1"]').click(); // new 3 -> 4
  await page.click("#edit-save");
  await page.locator("[data-approve]").nth(1).check();

  // Phone locks / page reloads mid-visit.
  await page.reload();
  await startLog(page, "2026-07-10");

  // Everything restored: edited value, edited marker, approval fold.
  const slot1 = page.locator("#slot-list > div").first();
  await expect(slot1).toContainText("new: 4");
  await expect(slot1).toContainText("(edited)");
  await expect(page.locator("[data-approve]").nth(1)).toBeChecked();

  // Submit successfully, reload again: the draft is gone, prefill is back.
  await approveAll(page);
  await page.click("#complete");
  await expect(page.locator("#view-submitted")).toBeVisible();
  expect(posts[0].slots[0]).toEqual({ slot: 1, waste: 3, new: 4 });

  await page.reload();
  await startLog(page, "2026-07-10");
  await expect(page.locator("#slot-list > div").first()).toContainText(
    "new: 3",
  ); // pristine prefill
  await expect(page.locator("[data-approve]").nth(1)).not.toBeChecked();
});
