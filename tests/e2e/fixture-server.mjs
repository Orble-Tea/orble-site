// Fixture server for integration tests between backend and frontend, with
// in-memory fakes of Nayax and Google Sheets. Writes change the state, so
// a submit can be checked end to end. Control endpoints for tests:
//   POST /__reset  {readable} restore the starting state
//   POST /__fail   {at, replyLost} fail the next matching call once
//   GET  /__state  machines, Restock Log rows keyed by header, and inventory
import http from "node:http";

export const PORT = Number(process.env.FIXTURE_PORT || 4545);

export const SCENARIO_DATES = {
  load: "2026-07-10",
  topoff: "2026-07-13",
  done: "2026-07-15",
};

// Failure points a test can arm through POST /__fail
export const FAIL_POINTS = {
  appendRow: "appendRow",
  nayaxGetSlots: "nayaxGetSlots",
  nayaxPut: "nayaxPut",
  nayaxPost: "nayaxPost",
  statusNayaxWritten: "statusNayaxWritten",
  zeroInventory: "zeroInventory",
  statusComplete: "statusComplete",
};

const MACHINE_30TH = 9999;
const MACHINE_TOWNE = 9998;
const OPERATOR_ID = 7777;
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_SERVER_ERROR = 500;
const HTTP_NOT_FOUND = 404;

// previous on-hand = PAR - MissingStockByMDB. IDs and prices are what a
// submit copies back into its PUT, so they must be present.
const product = (fields) => ({
  MachineID: MACHINE_30TH,
  CashPrice: 6.5,
  CreditCardPrice: 6.5,
  ...fields,
});
const NAYAX_PRODUCTS = [
  product({
    MachineProductID: "fx-1",
    NayaxProductID: 101,
    MDBCode: 1,
    DEXProductName: "Thai Tea 16oz Less Sweet w/ Lychee",
    PAR: 4,
    MissingStockByMDB: 1,
  }),
  product({
    MachineProductID: "fx-2",
    NayaxProductID: 102,
    MDBCode: 2,
    DEXProductName: "Matcha 16oz Less Sweet",
    PAR: 4,
    MissingStockByMDB: 2,
  }),
  product({
    MachineProductID: "fx-3",
    NayaxProductID: 103,
    MDBCode: 3,
    DEXProductName: "BMT22",
    PAR: 4,
    MissingStockByMDB: 1,
  }),
  product({
    MachineProductID: "fx-4",
    NayaxProductID: 104,
    MDBCode: 4,
    DEXProductName: "Taro 16oz",
    PAR: 4,
    MissingStockByMDB: 2,
  }),
  // Outside the slots the app manages: every submit must leave it as is
  product({
    MachineProductID: "fx-50",
    NayaxProductID: 150,
    MDBCode: 50,
    DEXProductName: "Instant Boba Pack",
    PAR: 10,
    MissingStockByMDB: 3,
  }),
];

// Towne carries the drinks the 30th Load plan swaps in, with the DEX names
// and prices the catalog entries below lack.
const TOWNE_PRODUCTS = [
  product({
    MachineID: MACHINE_TOWNE,
    MachineProductID: "fx-t1",
    NayaxProductID: 201,
    MDBCode: 1,
    DEXProductName: "Matcha 16oz Less Sweet w/ Lychee",
    PAR: 4,
    MissingStockByMDB: 0,
    CashPrice: 7,
    CreditCardPrice: 7,
  }),
  product({
    MachineID: MACHINE_TOWNE,
    MachineProductID: "fx-t2",
    NayaxProductID: 202,
    MDBCode: 2,
    DEXProductName: "Strawberry Matcha 16oz Less Sweet",
    PAR: 4,
    MissingStockByMDB: 0,
  }),
];

// The operator's catalog: which Nayax product each drink is.
const CATALOG_PRODUCTS = [
  { NayaxProductID: 201, ProductName: "Matcha 16oz Less Sweet w/ Lychee", DEXProductName: null, ProductCashPrice: null, ProductCreditCardPrice: null, ProductStatus: 1 },
  { NayaxProductID: 202, ProductName: "Strawberry Matcha 16oz Less Sweet", DEXProductName: null, ProductCashPrice: null, ProductCreditCardPrice: null, ProductStatus: 1 },
];

// Production Plan: headers must match getAmountHeader/getSlotHeader for 30th.
// Slot 6 has no Nayax product, so a Load creates it with a POST.
const PRODUCTION_PLAN_VALUES = [
  ["Drink Variation", "Amount to 30th", "Slot (30th)"],
  ["Matcha 16oz Less Sweet w/ Lychee", "6", "1, 6"],
  ["Strawberry Matcha 16oz Less Sweet", "2", "2"],
];

// Restock Log: header out of RESTOCK_LOG_HEADER order, so writing cells by position fails.
const RESTOCK_LOG_VALUES = [
  ["Status", "Batch ID", "Event", "Date", "Duration", "Slot Data"],
  ["Complete", "30th-2026-07-03", "Load"], // the batch a 07-10 Load clears out
  ["Complete", `30th-${SCENARIO_DATES.topoff}`, "Load"],
  ["Complete", `30th-${SCENARIO_DATES.done}`, "Load"],
  ["Complete", `30th-${SCENARIO_DATES.done}`, "Topoff"],
];

// Inventory: latest date-named sheet is picked via workbook metadata.
const INVENTORY_SHEET_TITLE = "2026-07-13";
const INVENTORY_VALUES = [
  ["Drink", "Storage", "To 30th", "To Towne"],
  ["Thai Tea 16oz Less Sweet w/ Lychee", "5", "2", "3"],
  ["Matcha 16oz Less Sweet", "1", "1", "1"],
];

const SHEET_IDS = {
  plan: "fixture-plan",
  inventory: "fixture-inventory",
  log: "fixture-log",
};
const TAB_BY_SHEET = {
  [SHEET_IDS.plan]: "Production Plan",
  [SHEET_IDS.log]: "Restock Log",
  [SHEET_IDS.inventory]: INVENTORY_SHEET_TITLE,
};

const clone = (value) => structuredClone(value);

/**
 * The starting state. `readable` swaps slot 3's unparseable DEX name for a
 * real drink, so a Topoff has no slot that blocks the submit.
 */
function startingState({ readable = false } = {}) {
  const products = clone(NAYAX_PRODUCTS);
  if (readable)
    products.find((p) => p.MDBCode === 3).DEXProductName = "Taro 16oz";
  return {
    machines: {
      [MACHINE_30TH]: products,
      [MACHINE_TOWNE]: clone(TOWNE_PRODUCTS),
    },
    tabs: {
      "Production Plan": clone(PRODUCTION_PLAN_VALUES),
      "Restock Log": clone(RESTOCK_LOG_VALUES),
      [INVENTORY_SHEET_TITLE]: clone(INVENTORY_VALUES),
    },
    createdCount: 0,
  };
}

let state = startingState();
let armed = null; // { at, replyLost }

function json(res, body, status = HTTP_OK) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString();
  return text ? JSON.parse(text) : undefined;
}

/** "'Restock Log'!E5:F5" -> { tab, cells: "E5:F5" }; a bare tab name has no cells. */
function parseRange(range) {
  const match = range.match(/^'((?:[^']|'')+)'(?:!(.+))?$/) || range.match(/^([^!]+)(?:!(.+))?$/);
  return { tab: match[1].replace(/''/g, "'"), cells: match[2] || null };
}

const columnIndex = (letters) =>
  [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

/** Writes `values` into the tab at the range's top-left cell. */
function writeCells(tab, cells, values) {
  const [, letters, row] = cells.match(/^([A-Z]+)(\d+)/);
  const top = Number(row) - 1;
  const left = columnIndex(letters);
  values.forEach((rowValues, r) => {
    const target = (state.tabs[tab][top + r] ||= []);
    rowValues.forEach((value, c) => {
      target[left + c] = value;
    });
  });
}

const flatIncludes = (values, text) =>
  values.some((row) => row.some((cell) => cell === text));

/**
 * Fails the call if it matches the armed failure point. With replyLost the
 * write is applied first and only the reply fails.
 */
function failureFor(point, apply) {
  if (armed?.at !== point) return false;
  const { replyLost } = armed;
  armed = null;
  if (replyLost) apply();
  return true;
}

function handleNayax(req, res, path, query, body) {
  const slots = path.match(/^\/nayax\/machines\/(\d+)\/machineProducts$/);
  if (slots) {
    const machineId = Number(slots[1]);
    const products = state.machines[machineId];
    if (!products) return json(res, { error: "no such machine" }, HTTP_NOT_FOUND);

    if (req.method === "GET") {
      if (machineId === MACHINE_30TH && failureFor(FAIL_POINTS.nayaxGetSlots, () => {}))
        return json(res, { error: "fixture: GET failed" }, HTTP_SERVER_ERROR);
      return json(res, products);
    }
    if (req.method === "PUT") {
      const apply = () => {
        if (query.get("avoidDelete") === "true") {
          for (const update of body) {
            const at = products.findIndex((p) => p.MachineProductID === update.MachineProductID);
            if (at >= 0) products[at] = update;
          }
        } else {
          state.machines[machineId] = clone(body);
        }
      };
      if (failureFor(FAIL_POINTS.nayaxPut, apply))
        return json(res, { error: "fixture: PUT failed" }, HTTP_SERVER_ERROR);
      apply();
      return json(res, []);
    }
    if (req.method === "POST") {
      // Nayax ignores missing stock on create and leaves it empty, and
      // returns the created records
      const created = [];
      const apply = () => {
        for (const product of body) {
          const record = {
            ...product,
            MachineID: machineId,
            MachineProductID: `fx-new-${++state.createdCount}`,
            MissingStockByMDB: null,
          };
          products.push(record);
          created.push(record);
        }
      };
      if (failureFor(FAIL_POINTS.nayaxPost, apply))
        return json(res, { error: "fixture: POST failed" }, HTTP_SERVER_ERROR);
      apply();
      return json(res, created);
    }
  }
  if (path === `/nayax/machines/${MACHINE_30TH}`)
    return json(res, { MachineID: MACHINE_30TH, OperatorActorID: OPERATOR_ID });
  if (path === `/nayax/machines/${MACHINE_TOWNE}`)
    return json(res, { MachineID: MACHINE_TOWNE, OperatorActorID: OPERATOR_ID });
  if (path === `/nayax/operators/${OPERATOR_ID}/products`)
    return json(res, CATALOG_PRODUCTS);
  return null;
}

function handleSheets(req, res, path, query, body) {
  // USER_ENTERED would turn "2026-07-10" into a date and "=..." into a formula
  if (req.method !== "GET" && query.get("valueInputOption") !== "RAW")
    return json(res, { error: "fixture: writes must use valueInputOption=RAW" }, HTTP_BAD_REQUEST);

  const append = path.match(/^\/sheets\/([^/]+)\/values\/(.+):append$/);
  if (append && req.method === "POST") {
    const { tab } = parseRange(append[2]);
    // Like Sheets, report the rows written as an A1 range
    const firstRow = state.tabs[tab].length + 1;
    const updatedRange = `'${tab}'!A${firstRow}:F${firstRow + body.values.length - 1}`;
    const apply = () => state.tabs[tab].push(...clone(body.values));
    if (tab === "Restock Log" && failureFor(FAIL_POINTS.appendRow, apply))
      return json(res, { error: "fixture: append failed" }, HTTP_SERVER_ERROR);
    apply();
    return json(res, { updates: { updatedRange } });
  }

  const values = path.match(/^\/sheets\/([^/]+)\/values\/(.+)$/);
  if (values) {
    const [, sheetId, range] = values;
    const { tab, cells } = parseRange(range);
    if (TAB_BY_SHEET[sheetId] !== tab) return json(res, { values: [] });

    if (req.method === "GET") return json(res, { values: state.tabs[tab] });
    if (req.method === "PUT") {
      const apply = () => writeCells(tab, cells, body.values);
      const point =
        tab === INVENTORY_SHEET_TITLE
          ? FAIL_POINTS.zeroInventory
          : flatIncludes(body.values, "Nayax written")
            ? FAIL_POINTS.statusNayaxWritten
            : flatIncludes(body.values, "Complete")
              ? FAIL_POINTS.statusComplete
              : null;
      if (point && failureFor(point, apply))
        return json(res, { error: "fixture: update failed" }, HTTP_SERVER_ERROR);
      apply();
      return json(res, {});
    }
  }

  // Workbook metadata: /sheets/{spreadsheetId}
  if (/^\/sheets\/([^/]+)$/.test(path))
    return json(res, { sheets: [{ properties: { title: INVENTORY_SHEET_TITLE } }] });
  return null;
}

export function createFixtureServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const path = decodeURIComponent(url.pathname);
    const body = req.method === "GET" ? undefined : await readBody(req);

    if (path === "/__reset" && req.method === "POST") {
      state = startingState({ readable: Boolean(body?.readable) });
      armed = null;
      return json(res, { ok: true });
    }
    if (path === "/__fail" && req.method === "POST") {
      armed = { at: body.at, replyLost: Boolean(body.replyLost) };
      return json(res, { ok: true });
    }
    if (path === "/__state" && req.method === "GET") {
      const [header, ...rows] = state.tabs["Restock Log"];
      return json(res, {
        machines: state.machines,
        log: rows.map((row) => Object.fromEntries(header.map((name, i) => [name, row[i] ?? ""]))),
        inventory: state.tabs[INVENTORY_SHEET_TITLE],
        armed,
      });
    }

    if (path.startsWith("/nayax/") && handleNayax(req, res, path, url.searchParams, body) !== null) return;
    if (path.startsWith("/sheets/") && handleSheets(req, res, path, url.searchParams, body) !== null) return;

    json(res, { error: `fixture server: unhandled ${req.method} ${path}` }, HTTP_NOT_FOUND);
  });
}

// Environment the astro dev server needs so the real backend talks to us.
export const BACKEND_ENV = {
  RESTOCK_SECRET_KEY: "test-key",
  NAYAX_API_TOKEN: "fixture-token",
  NAYAX_MACHINE_30TH_ID: String(MACHINE_30TH),
  NAYAX_MACHINE_TOWNE_ID: String(MACHINE_TOWNE),
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
