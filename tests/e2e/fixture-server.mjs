// @steered AudibleSecurityContext 1.2 2026-09-14
// Fixture server for layer 3 tests: fakes Nayax and Google Sheets so the REAL
// backend (restock-service.js and both API routes) runs against deterministic
// data. Scenario selection needs no control endpoint: the backend derives
// Load/Topoff/409 from Restock Log rows per batchId, and batchId = machine+date,
// so tests pick a scenario by choosing a date in the UI (see SCENARIO_DATES).
import http from "node:http";

export const PORT = Number(process.env.FIXTURE_PORT || 4545);

export const SCENARIO_DATES = {
  load: "2026-07-10", // no log rows for this batch -> Load
  topoff: "2026-07-13", // Load already logged -> Topoff
  done: "2026-07-15", // Load + Topoff logged -> 409
};

// Nayax machineProducts for machine id "9999" (NAYAX_MACHINE_30TH_ID in tests).
// previous on-hand = PAR - MissingStockByMDB.
const NAYAX_PRODUCTS = [
  {
    MDBCode: 1,
    DEXProductName: "Thai Tea 16oz Less Sugar w/ Lychee",
    PAR: 4,
    MissingStockByMDB: 1,
  }, // previous 3
  {
    MDBCode: 2,
    DEXProductName: "Matcha 16oz Less Sugar",
    PAR: 4,
    MissingStockByMDB: 2,
  }, // previous 2
  { MDBCode: 3, DEXProductName: "BMT22", PAR: 4, MissingStockByMDB: 1 }, // unparseable name -> warnings[]
  { MDBCode: 4, DEXProductName: "Taro 16oz", PAR: 4, MissingStockByMDB: 2 }, // no plan row -> retiring on Load
  // slots 5+ empty
];

// Production Plan: headers must match getAmountHeader/getSlotHeader for 30TH.
const PRODUCTION_PLAN_VALUES = [
  ["Drink Variation", "Amount to 30TH", "Slot (30TH)"],
  ["Matcha 16oz Less Sugar w/ Lychee", "3", "1"],
  ["Strawberry Matcha 16oz Less Sugar", "2", "2"],
];

// Restock Log: one static sheet covers every scenario, because the backend
// filters rows by batchId. Only the topoff/done dates have history.
const RESTOCK_LOG_VALUES = [
  ["Batch ID", "Event"],
  [`30TH-${SCENARIO_DATES.topoff}`, "Load"],
  [`30TH-${SCENARIO_DATES.done}`, "Load"],
  [`30TH-${SCENARIO_DATES.done}`, "Topoff"],
];

// Inventory: latest date-named sheet is picked via workbook metadata.
const INVENTORY_SHEET_TITLE = "2026-07-13";
const INVENTORY_VALUES = [
  ["Drink", "To 30TH"],
  ["Thai Tea 16oz Less Sugar w/ Lychee", "2"],
  ["Matcha 16oz Less Sugar", "1"],
];

const SHEET_IDS = {
  plan: "fixture-plan",
  inventory: "fixture-inventory",
  log: "fixture-log",
};

function json(res, body, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createFixtureServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const path = decodeURIComponent(url.pathname);

    // ---- Nayax ----
    if (path === "/nayax/machines/9999/machineProducts") {
      return json(res, NAYAX_PRODUCTS);
    }
    // Towne exists and is configured (matching production env); its machine
    // is simply empty until physically installed.
    if (path === "/nayax/machines/9998/machineProducts") {
      return json(res, []);
    }

    // ---- Google Sheets values: /sheets/{spreadsheetId}/values/{range} ----
    const values = path.match(/^\/sheets\/([^/]+)\/values\/(.+)$/);
    if (values) {
      const [, sheetId, range] = values;
      if (sheetId === SHEET_IDS.plan)
        return json(res, { values: PRODUCTION_PLAN_VALUES });
      if (sheetId === SHEET_IDS.log)
        return json(res, { values: RESTOCK_LOG_VALUES });
      if (
        sheetId === SHEET_IDS.inventory &&
        range.includes(INVENTORY_SHEET_TITLE)
      )
        return json(res, { values: INVENTORY_VALUES });
      return json(res, { values: [] });
    }

    // ---- Google Sheets workbook metadata: /sheets/{spreadsheetId} ----
    const meta = path.match(/^\/sheets\/([^/]+)$/);
    if (meta) {
      return json(res, {
        sheets: [{ properties: { title: INVENTORY_SHEET_TITLE } }],
      });
    }

    json(
      res,
      { error: `fixture server: unhandled ${req.method} ${path}` },
      404,
    );
  });
}

// Environment the astro dev server needs so the real backend talks to us.
export const BACKEND_ENV = {
  RESTOCK_SECRET_KEY: "test-key",
  NAYAX_API_TOKEN: "fixture-token",
  NAYAX_MACHINE_30TH_ID: "9999",
  NAYAX_MACHINE_TOWNE_ID: "9998",
  NAYAX_BASE_URL: `http://127.0.0.1:${PORT}/nayax`,
  SHEETS_BASE_URL: `http://127.0.0.1:${PORT}/sheets`,
  GOOGLE_SHEETS_ACCESS_TOKEN: "fixture-token", // skips the JWT/service-account path
  PRODUCTION_PLAN_SHEET_ID: SHEET_IDS.plan,
  INVENTORY_SHEET_ID: SHEET_IDS.inventory,
  RESTOCK_LOG_SHEET_ID: SHEET_IDS.log,
};

// Run directly: `node tests/e2e/fixture-server.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  createFixtureServer().listen(PORT, "127.0.0.1", () => {
    console.log(`fixture server on http://127.0.0.1:${PORT}`);
  });
}
