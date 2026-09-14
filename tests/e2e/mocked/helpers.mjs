// @steered AudibleSecurityContext 1.2 2026-09-14
// Shared helpers for the layer 2 (mocked-backend) specs. The canned payloads
// mirror the REAL restock-service contract: field names here (expectedNew,
// sweetnessLevel, previousDrink) were taken from buildRestockData's output,
// and layer 3 asserts the same names against the real service so this file
// cannot silently drift from reality without a layer 3 failure.
export const KEY = "test-key";

function slot(overrides) {
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

export function loadPayload() {
  return {
    batchId: "30TH-2026-07-10",
    event: "Load",
    machine: "30TH",
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
      // retiring: drinks out, plan puts nothing in -> "Empty" + removing line,
      // still needs approval, INCLUDED in the POST (waste must be recorded)
      slot({ slot: 3, previousDrink: "Taro 16oz", previous: 2, waste: 2 }),
      // empty slot -> greyed card, still needs approval, excluded from POST
      slot({ slot: 4 }),
    ],
  };
}

export function topoffPayload() {
  return {
    batchId: "30TH-2026-07-13",
    event: "Topoff",
    machine: "30TH",
    date: "2026-07-13",
    warnings: [],
    slots: [
      slot({
        slot: 1,
        previousDrink: "Thai Tea 16oz Less Sugar w/ Lychee",
        flavor: "Thai Tea",
        size: "16oz",
        topping: "Lychee",
        sweetnessLevel: "Less Sugar",
        previous: 3,
        waste: 0,
        expectedNew: 2,
        total: 5,
      }),
      slot({ slot: 2 }),
    ],
  };
}

export function warningPayload() {
  const payload = loadPayload();
  payload.slots[1] = slot({
    slot: 2,
    previousDrink: "BMT22",
    previous: 3,
    waste: 3,
  });
  payload.warnings = [{ slot: 2, code: "UNPARSEABLE_DRINK_NAME" }];
  return payload;
}

/** Intercepts GET /api/restock-data with a canned payload (layer 2 seam). */
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

/** Opens the landing and starts a log (30TH is preselected by the page). */
export async function startLog(page, date) {
  await page.goto(`/restock?key=${KEY}`);
  await page.fill("#batch-date", date);
  await page.click("#start-log");
}

export async function approveAll(page) {
  // Center each checkbox first: cards near the viewport bottom sit under the
  // translucent fixed Complete footer until scrolled, same as a human would.
  for (const box of await page.locator("[data-approve]").all()) {
    await box.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await box.check();
  }
}

/** Scrolls an element clear of the fixed footer, then clicks it. */
export async function scrollAndClick(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await locator.click();
}
