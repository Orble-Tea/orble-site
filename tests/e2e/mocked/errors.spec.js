// Browser tests: all error designs as one data table. Each row is a backend
// response and the copy the restocker must see; a loop makes nine states
// cost roughly one test's worth of code.
import { test, expect } from "@playwright/test";
import { MESSAGES, couldntSubmit } from "../../../src/lib/restock/errors.js";
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
    body: { error: MESSAGES.alreadySubmitted },
    copy: /already loaded and topped off/i,
  },
  {
    name: "upstream Nayax down (502)",
    status: 502,
    body: { error: "Nayax request failed with status 500" },
    copy: /Nayax request failed with status 500/i,
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

const NOT_SET_UP =
  "Matcha 16oz w/ Strawberry is not set up as a Nayax product on any machine. Add it in Nayax, then submit again.";

// Each row is a submit response and the exact message the restocker sees
const SUBMIT_ERRORS = [
  { name: "upstream failure (502)", status: 502, body: { error: "Google Sheets request failed" }, message: MESSAGES.retrySubmission },
  { name: "rejected (400)", status: 400, body: { error: NOT_SET_UP }, message: couldntSubmit(NOT_SET_UP) },
  { name: "already submitted (409)", status: 409, body: { error: MESSAGES.alreadySubmitted }, message: MESSAGES.alreadySubmitted },
  { name: "conflict without a reason (409)", status: 409, body: {}, message: MESSAGES.alreadySubmitted },
];

for (const err of SUBMIT_ERRORS) {
  test(`submit ${err.name}: shows the right message and keeps every entry`, async ({ page }) => {
    await mockData(page, loadPayload());
    await mockSubmit(page, { status: err.status, body: err.body });
    await startLog(page, "2026-07-10");
    await approveAll(page);
    await page.click("#complete");
    await expect(page.locator("#complete-hint")).toHaveText(err.message);
    await expect(page.locator("#loading-overlay")).toBeHidden();
    // The table is still there with every approval intact.
    await expect(page.locator("#view-table")).toBeVisible();
    for (const box of await page.locator("[data-approve]").all())
      await expect(box).toBeChecked();
  });
}

test("submit with no response: asks for a retry", async ({ page }) => {
  await mockData(page, loadPayload());
  await page.route("**/api/restock-submit", (route) => route.abort("connectionfailed"));
  await startLog(page, "2026-07-10");
  await approveAll(page);
  await page.click("#complete");
  await expect(page.locator("#complete-hint")).toHaveText(MESSAGES.retrySubmission);
});
