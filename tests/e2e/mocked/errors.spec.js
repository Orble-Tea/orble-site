// @steered AudibleSecurityContext 1.2 2026-09-14
// Layer 2: all error designs as one data table. Each row is a backend
// response and the copy the restocker must see; a loop makes nine states
// cost roughly one test's worth of code.
import { test, expect } from "@playwright/test";
import {
  loadPayload,
  mockData,
  mockSubmit,
  startLog,
  approveAll,
  KEY,
} from "./helpers.mjs";

const START_ERRORS = [
  {
    name: "invalid key (403)",
    status: 403,
    body: { error: "Invalid key" },
    copy: /isn't valid/i,
  },
  {
    name: "batch fully logged (409)",
    status: 409,
    body: { error: "This event has already been submitted for this batch." },
    copy: /already loaded and topped off/i,
  },
  {
    name: "upstream Nayax down (502)",
    status: 502,
    body: { error: "Nayax request failed with status 500" },
    copy: /Nayax request failed|Couldn't reach Nayax/i,
  },
  {
    name: "generic failure (500)",
    status: 500,
    body: { error: "Internal error" },
    copy: /went wrong|Internal error/i,
  },
];

for (const err of START_ERRORS) {
  test(`start log: ${err.name}`, async ({ page }) => {
    await mockData(page, err.body, err.status);
    await startLog(page, "2026-07-10");
    await expect(page.locator("#start-status")).toContainText(err.copy);
    await expect(page.locator("#view-table")).toBeHidden(); // never a broken half-table
  });
}

test("start log: network failure keeps selections and offers retry", async ({
  page,
}) => {
  await page.route("**/api/restock-data*", (route) =>
    route.abort("connectionfailed"),
  );
  await startLog(page, "2026-07-10");
  await expect(page.locator("#start-status")).toContainText(/connection/i);
  // Machine and date selections survive so retry is one tap.
  await expect(page.locator("#batch-date")).toHaveValue("2026-07-10");
});

test("submit failure keeps all entries and never loses work", async ({
  page,
}) => {
  await mockData(page, loadPayload());
  await mockSubmit(page, { status: 502 });
  await startLog(page, "2026-07-10");
  await approveAll(page);
  await page.click("#complete");
  await expect(page.locator("#complete-hint")).toContainText(
    /Nothing was sent/i,
  );
  // The table is still there with every approval intact.
  await expect(page.locator("#view-table")).toBeVisible();
  for (const box of await page.locator("[data-approve]").all())
    await expect(box).toBeChecked();
});

test("submit race (409): someone else already submitted", async ({ page }) => {
  await mockData(page, loadPayload());
  await mockSubmit(page, { status: 409 });
  await startLog(page, "2026-07-10");
  await approveAll(page);
  await page.click("#complete");
  await expect(page.locator("#complete-hint")).toContainText(
    /already submitted/i,
  );
});
