// Submit end to end: the real page and the real route against the stateful
// fixture server. Each event's happy path sets the reference end state; then
// every step the event runs fails once, and pressing Complete again must end
// in exactly that state, with the right message on screen in between.
import { test, expect } from "@playwright/test";
import { MESSAGES } from "../../../src/lib/restock/errors.js";
import {
  FAIL_POINTS,
  PORT,
  SCENARIO_DATES,
} from "../fixture-server.mjs";
import { approveAll, slotCard, startLog } from "../mocked/helpers.mjs";

test.describe.configure({ mode: "serial" });

const FIXTURE = `http://127.0.0.1:${PORT}`;
const LOAD_SLOT_COUNT = 35;

const control = (path, body) =>
  fetch(`${FIXTURE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
const reset = (event) => control("/__reset", { readable: event === "Topoff" });
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
    await page.click("#complete");
    await expectSubmitted(page);
    await attachScreen(page, testInfo, "submitted");

    const state = await storedState();
    const rows = newRows(state).slice(-2);
    expect(rows.map(summary)).toEqual([
      ["30th-2026-07-03", "Clearout", "Complete"],
      [`30th-${SCENARIO_DATES.load}`, "Load", "Complete"],
    ]);
    expect(slotData(rows[1])).toHaveLength(LOAD_SLOT_COUNT);
    expect(slotData(rows[0])).toEqual(slotData(rows[1]));
    expect(product(state, 1)).toMatchObject({ NayaxProductID: 201, PAR: 3, MissingStockByMDB: 0 });
    expect(product(state, 2)).toMatchObject({ NayaxProductID: 202, PAR: 2, MissingStockByMDB: 0 });
    expect(product(state, 3)).toBeUndefined(); // retired
    expect(product(state, 4)).toBeUndefined(); // retired
    expect(product(state, 6)).toMatchObject({ NayaxProductID: 201, PAR: 3, MissingStockByMDB: 0 }); // created
    expect(product(state, 50)).toEqual(product(before, 50));
    happyState.Load = state;
  });

  test("Topoff tops up slots, zeros the inventory column, and leaves slot 50 alone", async ({ page }, testInfo) => {
    await reset("Topoff");
    const before = await storedState();
    await openAndApprove(page, "Topoff");
    await page.click("#complete");
    await expectSubmitted(page);
    await attachScreen(page, testInfo, "submitted");

    const state = await storedState();
    const [row] = newRows(state).slice(-1);
    expect(summary(row)).toEqual([`30th-${SCENARIO_DATES.topoff}`, "Topoff", "Complete"]);
    expect(product(state, 1)).toMatchObject({ PAR: 4, MissingStockByMDB: 0 });
    expect(product(state, 2)).toMatchObject({ PAR: 3, MissingStockByMDB: 0 });
    // Only this machine's column is zeroed
    expect(state.inventory).toEqual(before.inventory.map((r, i) => (i === 0 ? r : [r[0], r[1], 0, r[3]])));
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
    FAIL_POINTS.statusNayaxWritten,
    FAIL_POINTS.statusComplete,
  ],
  Topoff: [
    [FAIL_POINTS.appendRow, true],
    FAIL_POINTS.nayaxGetSlots,
    FAIL_POINTS.nayaxPut,
    FAIL_POINTS.statusNayaxWritten,
    FAIL_POINTS.zeroInventory,
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
  for (const at of [FAIL_POINTS.nayaxPut, FAIL_POINTS.statusNayaxWritten]) {
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
      expect(slotData(loadRow).find((e) => e.Slot === 1)).toMatchObject({ New: 2, "Expected New": 3, Total: 2 });
      expect(product(state, 1)).toMatchObject({ PAR: 2, MissingStockByMDB: 0 });
    });
  }
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
  await expect(hint(pageB)).toHaveText(MESSAGES.alreadySubmitted);
  await attachScreen(pageB, testInfo, "already submitted");
  expect(await storedState()).toEqual(finished);

  await Promise.all([first.close(), second.close()]);
});
