// This is a live smoke test. Look at the README for guidance and proceed with caution.
import { test, expect } from "@playwright/test";
import { createSign } from "node:crypto";
import {
  canonicalDrinkKey,
  canonicalDrinkKeyFromParts,
  parseDrinkName,
} from "../../src/lib/restock/drinks.js";

const KEY = required("RESTOCK_SECRET_KEY");
const DATE = required("SMOKE_DATE"); // batch date that exists for machine 30th
const MACHINE = process.env.SMOKE_MACHINE || "30th";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} env var is required for the smoke test`);
  return value;
}

// ---- minimal independent Google Sheets reader (NOT the backend's client) ----
async function sheetsToken() {
  if (process.env.GOOGLE_SHEETS_ACCESS_TOKEN)
    return process.env.GOOGLE_SHEETS_ACCESS_TOKEN;
  const email = required("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const raw = required("GOOGLE_PRIVATE_KEY");
  const pem = (raw.startsWith("{") ? JSON.parse(raw).private_key : raw).replace(
    /\\n/g,
    "\n",
  );
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  })}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = signer.sign(pem, "base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!response.ok) throw new Error(`Google auth failed: ${response.status}`);
  return (await response.json()).access_token;
}

async function readSheet(token, spreadsheetId, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok)
    throw new Error(`Sheets read failed (${range}): ${response.status}`);
  return (await response.json()).values || [];
}

function toObjects(values) {
  const [headers = [], ...rows] = values;
  return rows.map((row) =>
    Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""])),
  );
}

/** Sheet headers are hand-typed, so match them case-insensitively. */
function cell(row, header) {
  const key = Object.keys(row).find(
    (k) => k.trim().toLowerCase() === header.toLowerCase(),
  );
  return key ? row[key] : "";
}

/**
 * Deliberately coarse: the smoke checks that no unit of any drink is lost or
 * invented end to end. Slot-level placement is the Integration tests' job.
 */
function canonicalDrinkKeyFromCard(title, quals) {
  const parts = { flavor: title, size: null, topping: null, sweetness: null };
  for (const qual of quals) {
    const parsed = parseDrinkName(qual);
    if (parsed.size) parts.size = parsed.size;
    else if (parsed.sweetness) parts.sweetness = parsed.sweetness;
    else parts.topping = qual;
  }
  return canonicalDrinkKeyFromParts(parts);
}

/**
 * Sums the rendered "new" count per drink. Each slot card's body holds the
 * flavor title, then one small line per size/topping/sweetness.
 */
async function renderedByDrink(page) {
  const cards = page.locator("#slot-list > div");
  const byDrink = new Map();
  const rows = [];
  for (let i = 0; i < (await cards.count()); i++) {
    const card = cards.nth(i);
    const body = card.locator(".flex-1").first();
    const title = (await body.locator("> div").first().innerText()).trim();
    if (title === "Empty") continue;
    const quals = await body.locator("> div.text-xs").allInnerTexts();
    const text = (await card.innerText()).replace(/\n/g, " | ");
    const key = canonicalDrinkKeyFromCard(title, quals);
    const newCount = Number(text.match(/new:\s*(\d+)/)?.[1] ?? 0);
    rows.push({ key, newCount, text });
    byDrink.set(key, (byDrink.get(key) || 0) + newCount);
  }
  return { byDrink, rows };
}

test("live derivation: rendered table corresponds to Production Plan / Inventory", async ({
  page,
}) => {
  // Independent sheet reads happen FIRST so a backend outage fails clearly.
  const token = await sheetsToken();
  const plan = toObjects(
    await readSheet(
      token,
      required("PRODUCTION_PLAN_SHEET_ID"),
      "'Production Plan'",
    ),
  );
  const log = toObjects(
    await readSheet(token, required("RESTOCK_LOG_SHEET_ID"), "'Restock Log'"),
  );

  // Expected event, derived naively from the raw log.
  const batchId = `${MACHINE}-${DATE}`;
  const events = log
    .filter((r) => cell(r, "Batch ID") === batchId)
    .map((r) => String(cell(r, "Event")).toLowerCase());
  const expectedEvent = !events.includes("load")
    ? "Load"
    : !events.includes("topoff")
      ? "Topoff"
      : null;
  test.skip(
    expectedEvent === null,
    `batch ${batchId} is fully logged; pick another SMOKE_DATE`,
  );

  // Drive the real page. READ-ONLY: never tap Complete.
  await page.goto(`/restock?key=${KEY}`);
  await page.fill("#batch-date", DATE);
  await page.click("#start-log");
  // The backend may refuse the batch (unreadable sheet rows, auth). Fail with
  // its message rather than a 60s timeout on the table.
  await expect(
    page.locator("#view-table:not(.hidden), #start-status:not(.hidden)"),
  ).toBeVisible({ timeout: 60_000 });
  const refusal = page.locator("#start-status:not(.hidden)");
  if (await refusal.isVisible())
    throw new Error(`page refused the batch: ${await refusal.innerText()}`);
  await expect(page.locator("#table-event")).toHaveText(expectedEvent);

  const { byDrink, rows } = await renderedByDrink(page);
  await page.screenshot({ path: "smoke-table.png", fullPage: true });
  const dump = () =>
    `rendered:\n${rows.map((r) => `  ${r.text}`).join("\n")}\nsee smoke-table.png`;

  if (expectedEvent === "Load") {
    // Per drink: units the plan calls for == units the table tells the
    // restocker to load. A mismatch means the derivation lost or invented
    // drinks somewhere between the sheet and the screen.
    const planByDrink = new Map();
    for (const row of plan) {
      const variation = cell(row, "Drink Variation") || cell(row, "Variation");
      const amount = Number(cell(row, `Amount to ${MACHINE}`) || 0);
      if (!variation || !amount) continue;
      const key = canonicalDrinkKey(variation);
      planByDrink.set(key, (planByDrink.get(key) || 0) + amount);
    }
    expect(
      planByDrink.size,
      "Production Plan has no rows for this machine; pick a planned SMOKE_DATE",
    ).toBeGreaterThan(0);
    for (const [key, amount] of planByDrink) {
      expect
        .soft(byDrink.get(key) || 0, `plan says ${amount}x ${key}\n${dump()}`)
        .toBe(amount);
    }
  } else {
    // Topoff: you cannot top off with more of a drink than cold storage has.
    // The Inventory workbook keeps one sheet per day; use the latest
    // date-named tab, matching how the workbook is organized.
    const invId = required("INVENTORY_SHEET_ID");
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${invId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const sheetTitles = ((await metaRes.json()).sheets || [])
      .map((sh) => sh.properties?.title)
      .filter(Boolean);
    const latest =
      sheetTitles
        .filter((t) => !Number.isNaN(Date.parse(t)))
        .sort((a, b) => Date.parse(a) - Date.parse(b))
        .at(-1) || sheetTitles.at(-1);
    const inventory = toObjects(await readSheet(token, invId, `'${latest}'`));
    const stockByDrink = new Map();
    for (const row of inventory) {
      const drink = cell(row, "Drink");
      if (!drink) continue;
      const key = canonicalDrinkKey(drink);
      stockByDrink.set(
        key,
        (stockByDrink.get(key) || 0) + Number(cell(row, `To ${MACHINE}`) || 0),
      );
    }
    for (const [key, added] of byDrink) {
      if (added === 0) continue;
      expect
        .soft(
          added,
          `table adds ${added}x ${key} but storage has ${stockByDrink.get(key) || 0}\n${dump()}`,
        )
        .toBeLessThanOrEqual(stockByDrink.get(key) || 0);
    }
  }
});
