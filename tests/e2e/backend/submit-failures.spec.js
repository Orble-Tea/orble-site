// Submit end to end: the real page and the real route against the stateful
// fixture server. Each event's happy path sets the reference end state; then
// every step the event runs fails once, and pressing Complete again must end
// in exactly that state, with the right message on screen in between.
import { test, expect } from "@playwright/test";
import { ERRORS, MESSAGES } from "../../../src/lib/restock/errors.js";
import {
  FAIL_POINTS,
  PORT,
  SCENARIO_DATES,
} from "../fixture-server.mjs";
import { approveAll, slotCard, startLog } from "../mocked/helpers.mjs";

test.describe.configure({ mode: "serial" });

const FIXTURE = `http://127.0.0.1:${PORT}`;

const control = (path, body) =>
  fetch(`${FIXTURE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
const reset = (event, options = {}) =>
  control("/__reset", { readable: event === "Topoff", ...options });
const failOnce = (at, replyLost = false) => control("/__fail", { at, replyLost });

/** Stored state, minus Duration, which depends on how long the test took. */
async function storedState() {
  const { machines, log, inventory } = await (await fetch(`${FIXTURE}/__state`)).json();
  return {
    machines,
    log: log.map(({ Duration: _duration, ...row }) => row),
    inventory,
  };
}

const slotData = (row) => JSON.parse(row["Slot Data"]);
const newRows = (state) => state.log.filter((row) => row["Slot Data"]);
const summary = (row) => [row["Batch ID"], row.Event, row.Status];
const product = (state, slot) => state.machines[9999].find((p) => p.MDBCode === slot);

const hint = (page) => page.locator("#complete-hint");

async function attachScreen(page, testInfo, name) {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

const DATES = { Load: SCENARIO_DATES.load, Topoff: SCENARIO_DATES.topoff };

/** Starts the event's log on the page and approves every slot. */
async function openAndApprove(page, event) {
  await startLog(page, DATES[event]);
  await expect(page.locator("#table-event")).toHaveText(event);
  await approveAll(page);
}

/** Lowers slot 1's new count by one. An approved slot hides its edit button. */
async function lowerSlot1New(page) {
  await page.locator('[data-approve="0"]').uncheck();
  await slotCard(page, 1).locator("[data-edit]").click();
  await page.locator('[data-step="newCount:-1"]').click();
  await page.click("#edit-save");
  await approveAll(page);
}

async function expectSubmitted(page) {
  await expect(page.locator("#view-submitted")).toBeVisible();
  await expect(page.getByRole("heading", { name: MESSAGES.restockSubmitted, exact: true })).toBeVisible();
}

async function expectRetryShown(page) {
  await expect(hint(page)).toHaveText(MESSAGES.retrySubmission);
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await expect(page.locator("#view-table")).toBeVisible();
  for (const box of await page.locator("[data-approve]").all()) await expect(box).toBeChecked();
}

const happyState = {};

test.describe("happy path", () => {
  test("Load closes the old batch, swaps and creates slots, and leaves slot 50 alone", async ({ page }, testInfo) => {
    await reset("Load");
    const before = await storedState();
    await openAndApprove(page, "Load");
    await expect(page.locator("#batch-warning")).toContainText("Jul 15");
    await page.click("#complete");
    await expectSubmitted(page);
    await attachScreen(page, testInfo, "submitted");

    const state = await storedState();
    const rows = newRows(state).slice(-2);
    expect(rows.map(summary)).toEqual([
      [`30th-${SCENARIO_DATES.topoff}`, "Clearout", "Complete"],
      [`30th-${SCENARIO_DATES.load}`, "Load", "Complete"],
    ]);
    expect(product(state, 1)).not.toEqual(product(before, 1)); // swapped
    expect(product(state, 3)).toBeUndefined(); // retired
    expect(product(state, 4)).toBeUndefined(); // retired
    expect(product(state, 6)).toBeDefined(); // created
    expect(product(state, 50)).toEqual(product(before, 50));
    happyState.Load = state;
  });

  test("Load after a standalone Clearout writes no second Clearout row and no warning", async ({ page }) => {
    await reset("Load", { clearedOut: true });
    await openAndApprove(page, "Load");
    await expect(page.locator("#batch-warning")).toBeHidden();
    await page.click("#complete");
    await expectSubmitted(page);

    expect(newRows(await storedState()).map(summary)).toEqual([
      [`30th-${SCENARIO_DATES.load}`, "Load", "Complete"],
    ]);
  });

  test("Topoff tops up slots and leaves slot 50 alone", async ({ page }, testInfo) => {
    await reset("Topoff");
    const before = await storedState();
    await openAndApprove(page, "Topoff");
    await page.click("#complete");
    await expectSubmitted(page);
    await attachScreen(page, testInfo, "submitted");

    const state = await storedState();
    const [row] = newRows(state).slice(-1);
    expect(summary(row)).toEqual([`30th-${SCENARIO_DATES.topoff}`, "Topoff", "Complete"]);
    expect(product(state, 1)).not.toEqual(product(before, 1)); // topped up
    expect(state.inventory).toEqual(before.inventory);
    expect(product(state, 50)).toEqual(product(before, 50));
    happyState.Topoff = state;
  });
});

// Every step each event runs, failing once. Load's rejected append covers every failure that writes nothing.
const STEPS = {
  Load: [
    FAIL_POINTS.appendRow,
    [FAIL_POINTS.appendRow, true],
    FAIL_POINTS.nayaxGetSlots,
    FAIL_POINTS.nayaxPost,
    FAIL_POINTS.nayaxPut,
    FAIL_POINTS.statusComplete,
  ],
  Topoff: [
    [FAIL_POINTS.appendRow, true],
    FAIL_POINTS.nayaxGetSlots,
    FAIL_POINTS.nayaxPut,
    FAIL_POINTS.statusComplete,
  ],
};

test.describe("one step fails, then a retry finishes", () => {
  for (const [event, steps] of Object.entries(STEPS)) {
    for (const step of steps) {
      const [at, replyLost] = Array.isArray(step) ? step : [step, false];
      test(`${event}: ${at}${replyLost ? " (reply lost)" : ""} fails, Complete again finishes`, async ({ page }, testInfo) => {
        await reset(event);
        await openAndApprove(page, event);
        await failOnce(at, replyLost);

        await page.click("#complete");
        await expectRetryShown(page);
        await attachScreen(page, testInfo, "error screen");

        await page.click("#complete");
        await expectSubmitted(page);
        await attachScreen(page, testInfo, "submitted");
        expect(await storedState()).toEqual(happyState[event]);
      });
    }
  }
});

test.describe("edited retry", () => {
  for (const at of [FAIL_POINTS.nayaxPut, FAIL_POINTS.statusComplete]) {
    test(`Load: ${at} fails, an edited count is applied on retry`, async ({ page }, testInfo) => {
      await reset("Load");
      await openAndApprove(page, "Load");
      await failOnce(at);
      await page.click("#complete");
      await expectRetryShown(page);

      await lowerSlot1New(page); // 3 new -> 2
      await page.click("#complete");
      await expectSubmitted(page);
      await attachScreen(page, testInfo, "submitted");

      const state = await storedState();
      const loadRow = newRows(state).at(-1);
      expect(loadRow.Status).toBe("Complete");
      expect(slotData(loadRow).find((e) => e.Slot === 1)).toMatchObject({ New: 2, "Expected New": 3 });
      expect(product(state, 1)).toMatchObject({ PAR: 2 });
    });
  }

  test("Load on a machine's first batch leaves another machine's Clearout row above it alone", async ({ page }, testInfo) => {
    await reset("Load", { firstLoad: true });
    const towneRow = (await storedState()).log[0];
    await openAndApprove(page, "Load");
    await failOnce(FAIL_POINTS.nayaxPut);
    await page.click("#complete");
    await expectRetryShown(page);

    await lowerSlot1New(page); // 3 new -> 2
    await page.click("#complete");
    await expectSubmitted(page);
    await attachScreen(page, testInfo, "submitted");

    const state = await storedState();
    expect(state.log[0]).toEqual(towneRow);
    expect(state.log.map(summary)).toEqual([
      [`Towne-${SCENARIO_DATES.done}`, "Clearout", "Complete"],
      [`30th-${SCENARIO_DATES.load}`, "Load", "Complete"],
    ]);
  });
});

test("a stale page that submits after the Load finished sees 'already submitted'", async ({ browser }, testInfo) => {
  await reset("Load");
  const [first, second] = await Promise.all([browser.newContext(), browser.newContext()]);
  const [pageA, pageB] = await Promise.all([first.newPage(), second.newPage()]);
  await openAndApprove(pageA, "Load");
  await openAndApprove(pageB, "Load");

  await pageA.click("#complete");
  await expectSubmitted(pageA);
  const finished = await storedState();

  // Page B was opened before the Load finished, and changes a count
  await lowerSlot1New(pageB);
  await pageB.click("#complete");
  await expect(hint(pageB)).toHaveText(ERRORS.alreadySubmitted.message);
  await attachScreen(pageB, testInfo, "already submitted");
  expect(await storedState()).toEqual(finished);

  await Promise.all([first.close(), second.close()]);
});
