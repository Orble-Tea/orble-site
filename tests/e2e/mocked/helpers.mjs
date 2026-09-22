// Shared helpers for Browser tests
import { expect } from "@playwright/test";

export const KEY = "test-key";

/** The slot's card element, located by slot number instead of DOM order. */
export function slotCard(page, n) {
  return page.locator(`[data-slot="${n}"]`);
}

/** Rendered chip colors the Browser tests assert against. */
export const CHIP_COLORS = {
  mint: "rgb(234, 246, 242)",
  muted: "rgb(243, 244, 246)",
};

/** One slot in the canned payload shape, with overridable fields. */
export function slot(overrides) {
  return {
    slot: 0,
    previousDrink: null,
    flavor: null,
    size: null,
    topping: null,
    sweetnessLevel: null,
    previous: 0,
    waste: 0,
    expectedNew: 0,
    total: 0,
    ...overrides,
  };
}

/** Canned Load payload: swap, same-drink, retiring, and empty slots. */
export function loadPayload() {
  return {
    batchId: "30th-2026-07-10",
    event: "Load",
    machine: "30th",
    date: "2026-07-10",
    warnings: [],
    slots: [
      // swap: Thai Tea goes out, Matcha goes in -> "replacing" line
      slot({
        slot: 1,
        previousDrink: "Thai Tea 16oz Less Sugar w/ Lychee",
        flavor: "Matcha",
        size: "16oz",
        topping: "Lychee",
        sweetnessLevel: "Less Sugar",
        previous: 3,
        waste: 3,
        expectedNew: 3,
        total: 3,
      }),
      // same drink stays -> no replacing line
      slot({
        slot: 2,
        previousDrink: "Matcha 16oz Less Sugar",
        flavor: "Matcha",
        size: "16oz",
        sweetnessLevel: "Less Sugar",
        previous: 2,
        waste: 2,
        expectedNew: 2,
        total: 2,
      }),
      // retiring: drinks out, plan puts nothing in -> "Empty" + removing line
      slot({ slot: 3, previousDrink: "Taro 16oz", previous: 2, waste: 2 }),
      // empty slot -> greyed card
      slot({ slot: 4 }),
    ],
  };
}

/** Intercepts GET /api/restock-data with a canned payload. */
export async function mockData(page, payload, status = 200) {
  await page.route("**/api/restock-data*", (route) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(payload),
    }),
  );
}

/** Intercepts POST /api/restock-submit, capturing bodies. Returns the capture list. */
export async function mockSubmit(page, { status = 200 } = {}) {
  const posts = [];
  await page.route("**/api/restock-submit", (route) => {
    posts.push(route.request().postDataJSON());
    return route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(
        status === 200 ? { success: true } : { error: "nope" },
      ),
    });
  });
  return posts;
}

/** Opens the landing and starts a log (30th is preselected by the page). */
export async function startLog(page, date) {
  await page.goto(`/restock?key=${KEY}`);
  await page.fill("#batch-date", date);
  await page.click("#start-log");
}

/** Approves every slot checkbox, scrolling each clear of the footer. */
export async function approveAll(page) {
  await page.locator("[data-approve]").first().waitFor();
  // scroll to each box and then check
  const count = await page.locator("[data-approve]").count();
  for (let i = 0; i < count; i++) {
    const box = page.locator(`[data-approve="${i}"]`);
    await box.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await box.check();
    await expect(box).toBeChecked();
  }
}
