// This is a live smoke test. Look at the README for guidance and proceed with caution.
import { test, expect } from "@playwright/test";
import { createSign } from "node:crypto";

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

// Aggregation key is the FLAVOR (first word-group before the size token).
// Deliberately coarse: the smoke checks that no unit of any drink is lost or
// invented end to end. Slot-level placement is the Integration tests' job.
function flavorOf(variation) {
  return String(variation)
    .split(/\s+\d+oz\b/i)[0]
    .trim()
    .toLowerCase();
}

// ---- what the page actually rendered, scraped per slot card ----
async function renderedByFlavor(page) {
  const cards = await page.locator("#slot-list > div").allInnerTexts();
  const byFlavor = new Map();
  const rows = [];
  for (const text of cards) {
    if (/^\s*Empty/m.test(text)) continue;
    const title = text.split("\n")[0].trim().toLowerCase();
    const newCount = Number(text.match(/new:\s*(\d+)/)?.[1] ?? 0);
    rows.push({ title, newCount, text: text.replace(/\n/g, " | ") });
    byFlavor.set(title, (byFlavor.get(title) || 0) + newCount);
  }
  return { byFlavor, rows };
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
    .filter((r) => r["Batch ID"] === batchId)
    .map((r) => String(r["Event"]).toLowerCase());
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
  await expect(page.locator("#view-table")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#table-event")).toHaveText(expectedEvent);

  const { byFlavor, rows } = await renderedByFlavor(page);
  await page.screenshot({ path: "smoke-table.png", fullPage: true });
  const dump = () =>
    `rendered:\n${rows.map((r) => `  ${r.text}`).join("\n")}\nsee smoke-table.png`;

  if (expectedEvent === "Load") {
    // Per drink: units the plan calls for == units the table tells the
    // restocker to load. A mismatch means the derivation lost or invented
    // drinks somewhere between the sheet and the screen.
    const planByFlavor = new Map();
    for (const row of plan) {
      const variation = row["Drink Variation"] || row["Variation"];
      // Sheet headers may case the machine name differently (e.g. "30TH");
      // match the column case-insensitively without importing backend code.
      const amountKey = Object.keys(row).find(
        (k) => k.toLowerCase() === `amount to ${MACHINE}`.toLowerCase(),
      );
      const amount = Number((amountKey && row[amountKey]) || 0);
      if (!variation || !amount) continue;
      const flavor = flavorOf(variation);
      planByFlavor.set(flavor, (planByFlavor.get(flavor) || 0) + amount);
    }
    expect(
      planByFlavor.size,
      "Production Plan has no rows for this machine; pick a planned SMOKE_DATE",
    ).toBeGreaterThan(0);
    for (const [flavor, amount] of planByFlavor) {
      expect
        .soft(
          byFlavor.get(flavor) || 0,
          `plan says ${amount}x ${flavor}\n${dump()}`,
        )
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
    const stockByFlavor = new Map();
    for (const row of inventory) {
      if (!row["Drink"]) continue;
      const flavor = flavorOf(row["Drink"]);
      stockByFlavor.set(
        flavor,
        (stockByFlavor.get(flavor) || 0) + Number(row[`To ${MACHINE}`] || 0),
      );
    }
    for (const [flavor, added] of byFlavor) {
      if (added === 0) continue;
      expect
        .soft(
          added,
          `table adds ${added}x ${flavor} but storage has ${stockByFlavor.get(flavor) || 0}\n${dump()}`,
        )
        .toBeLessThanOrEqual(stockByFlavor.get(flavor) || 0);
    }
  }
});
