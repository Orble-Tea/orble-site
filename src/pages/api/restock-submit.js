// @steered AudibleSecurityContext 1.2 2026-10-01
// Submits a confirmed restock as a saga tracked in the Restock Log: a
// Pending row first, then Nayax, then (Topoff) this machine's Inventory
// column, moving the row's Status after each step. A resend finds the row
// and finishes from where the last attempt stopped.
import {
  assertConfigured,
  getMachineConfig,
  getMachineSlots,
  MACHINE_CONFIG,
  requireRestockSecretKey,
  RESTOCK_EVENTS,
  RESTOCK_LOG_SHEET,
  SHEET_IDS,
} from "../../lib/restock/config.js";
import {
  appendSheetValues,
  getLatestSheetName,
  readSheetValues,
  rowsToObjects,
  updateSheetValues,
} from "../../lib/restock/google-sheets.js";
import {
  badRequest,
  conflict,
  invalidKey,
  json,
  parseJson,
  serverError,
  upstreamError,
} from "../../lib/restock/http.js";
import { UpstreamServiceError } from "../../lib/restock/errors.js";
import { totalAfter } from "../../lib/restock/slot-validation-rules.js";
import {
  createMachineProducts,
  getMachine,
  getMachineProducts,
  getOperatorProducts,
  putMachineProducts,
} from "../../lib/restock/nayax.js";
import { buildRestockData } from "../../lib/restock/restock-service.js";
import {
  buildNayaxCatalog,
  buildNayaxUpdate,
  buildRestockLogRows,
  decideSaga,
  parseSlotData,
  RESTOCK_LOG_HEADER,
  rewriteSlotData,
  SAGA_STATUS,
  toSheetRow,
  validateSubmission,
} from "../../lib/restock/submit-service.js";

// Orble's machines are in Seattle; the log's Date is the local day.
const VISIT_TIME_ZONE = "America/Los_Angeles";

function todayInVisitZone() {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: VISIT_TIME_ZONE,
  }).format(new Date());
}

const lower = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

/** The machine's most recent Load batch before this date, or null. */
function findPreviousBatchId(rows, machineLabel, date) {
  const prefix = `${machineLabel}-`;
  const earlier = rows
    .filter((row) => lower(row.Event) === lower(RESTOCK_EVENTS.load))
    .map((row) => String(row["Batch ID"] ?? "").trim())
    .filter(
      (batchId) =>
        lower(batchId).startsWith(lower(prefix)) &&
        batchId.slice(prefix.length) < date,
    )
    .sort();
  return earlier.at(-1) || null;
}

function columnLetter(index) {
  let letters = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}

async function readLog(logSheetId) {
  const values = await readSheetValues(logSheetId, RESTOCK_LOG_SHEET);
  return { header: values[0] || [], rows: rowsToObjects(values) };
}

/** The rows a submit owns. A Load's Clearout row for the old batch was appended just above it. */
function sagaRows(rows, own) {
  if (lower(own.Event) !== lower(RESTOCK_EVENTS.load)) return [own];
  const clearout = rows.find(
    (row) =>
      row._rowNumber === own._rowNumber - 1 &&
      lower(row.Event) === lower(RESTOCK_EVENTS.clearout),
  );
  return clearout ? [clearout, own] : [own];
}

/** Sets Status on the saga's rows in one request; they are adjacent. */
async function setStatus(logSheetId, header, saga, status) {
  const letter = columnLetter(header.indexOf("Status"));
  await updateSheetValues(
    logSheetId,
    RESTOCK_LOG_SHEET,
    `${letter}${saga[0]._rowNumber}:${letter}${saga.at(-1)._rowNumber}`,
    saga.map(() => [status]),
    "RAW",
  );
}

/** Rewrites the saga's rows with `fields` changed, in one request. */
async function overwriteRows(logSheetId, header, saga, fields) {
  await updateSheetValues(
    logSheetId,
    RESTOCK_LOG_SHEET,
    `A${saga[0]._rowNumber}:${columnLetter(header.length - 1)}${saga.at(-1)._rowNumber}`,
    saga.map((row) => toSheetRow(header, { ...row, ...fields })),
    "RAW",
  );
}

/**
 * Appends row objects in the log's own column order; an empty tab gets the
 * header first. Returns the header in use and the appended rows with their
 * row numbers, taken from the range the append reports writing.
 */
async function appendRows(logSheetId, header, rows) {
  const usedHeader = header.length > 0 ? header : RESTOCK_LOG_HEADER;
  const values = rows.map((row) => toSheetRow(usedHeader, row));
  if (header.length === 0) values.unshift(RESTOCK_LOG_HEADER);
  const response = await appendSheetValues(
    logSheetId,
    RESTOCK_LOG_SHEET,
    values,
    "RAW",
  );
  // e.g. "'Restock Log'!A5:F6"
  const firstRow = Number(
    response?.updates?.updatedRange?.match(/![A-Z]+(\d+)/)?.[1],
  );
  if (!firstRow)
    throw new UpstreamServiceError("Sheets append did not report its range", {
      service: "google-sheets",
      operation: "append_restock_log",
    });
  const firstDataRow = header.length > 0 ? firstRow : firstRow + 1;
  return {
    header: usedHeader,
    appended: rows.map((row, index) => ({
      ...row,
      _rowNumber: firstDataRow + index,
    })),
  };
}

/** A Topoff uses up the storage allocated to this machine: zero its column. */
async function zeroInventoryColumn(machineConfig) {
  const spreadsheetId = assertConfigured(
    SHEET_IDS.inventory,
    "INVENTORY_SHEET_ID",
  );
  const sheetName = await getLatestSheetName(spreadsheetId);
  const [header = [], ...rows] = await readSheetValues(
    spreadsheetId,
    sheetName,
  );
  const column = header.findIndex(
    (name) => lower(name) === lower(`To ${machineConfig.label}`),
  );
  if (column < 0 || rows.length === 0) return;
  const letter = columnLetter(column);
  await updateSheetValues(
    spreadsheetId,
    sheetName,
    `${letter}2:${letter}${rows.length + 1}`,
    rows.map(() => [0]),
    "RAW",
  );
}

/**
 * The operator's catalog, plus every machine's slots for the DEX names and
 * prices the catalog lacks. The operator ID comes from the machine record.
 */
async function loadCatalog(machineConfig, currentProducts) {
  const machine = await getMachine(machineConfig.machineId);
  const operatorId = machine?.OperatorActorID ?? machine?.ActorID;
  const [catalogProducts, ...others] = await Promise.all([
    getOperatorProducts(operatorId),
    ...MACHINE_CONFIG.filter(
      (other) => other.machineId && other !== machineConfig,
    ).map((other) => getMachineProducts(other.machineId)),
  ]);
  return buildNayaxCatalog(catalogProducts, [
    ...currentProducts,
    ...others.flat(),
  ]);
}

/**
 * Writes the plan with one full PUT. Slots Nayax lacks are created first;
 * the create returns the new records, so the PUT includes them and sets
 * their missing stock, which Nayax leaves empty on create.
 */
async function syncNayax(machineId, currentProducts, plan, planFor) {
  let finalPlan = plan;
  if (plan.post.length > 0) {
    const created = await createMachineProducts(machineId, plan.post);
    if (created.length !== plan.post.length)
      throw new UpstreamServiceError(
        `Nayax created ${created.length} of ${plan.post.length} slots`,
        { service: "nayax", operation: "create_machine_products" },
      );
    finalPlan = planFor([...currentProducts, ...created]);
  }
  if (finalPlan.put)
    await putMachineProducts(machineId, finalPlan.put, { avoidDelete: false });
}

export async function POST({ request }) {
  let body;
  try {
    body = await parseJson(request);
  } catch {
    return badRequest("Invalid JSON body");
  }

  if (!requireRestockSecretKey(body.key)) return invalidKey();

  const required = ["batchId", "event", "machine", "date", "slots"];
  const missing = required.filter((field) => !body[field]);
  if (missing.length > 0 || !Array.isArray(body.slots)) {
    return badRequest("Missing required fields");
  }

  const machineConfig = getMachineConfig(body.machine);
  if (!machineConfig) return badRequest(`Unknown machine: ${body.machine}`);
  const { event, date, batchId, slots } = body;
  if (batchId !== `${machineConfig.label}-${date}`)
    return badRequest("batchId does not match the machine and date");

  const problem = validateSubmission({
    event,
    slots,
    machineSlots: getMachineSlots(machineConfig),
  });
  if (problem) return badRequest(problem);

  try {
    const logSheetId = assertConfigured(
      SHEET_IDS.restockLog,
      "RESTOCK_LOG_SHEET_ID",
    );
    let { header, rows } = await readLog(logSheetId);
    const decision = decideSaga({
      rows,
      batchId,
      event,
      submittedSlots: slots,
    });
    if (decision.action === "reject")
      return decision.status === 409
        ? conflict(decision.error)
        : badRequest(decision.error);

    if (decision.action !== "done") {
      let saga = decision.row && sagaRows(rows, decision.row);
      if (decision.from !== "inventory") {
        const { machineId } = machineConfig;
        const currentProducts = await getMachineProducts(machineId);
        const catalog = await loadCatalog(machineConfig, currentProducts);
        const nayaxSlots = slots.map((slot) => ({
          slot: slot.slot,
          drink: slot.drink,
          total: totalAfter(slot.previous, slot.waste, slot.new),
        }));
        const planFor = (products) =>
          buildNayaxUpdate({
            currentProducts: products,
            catalog,
            slots: nayaxSlots,
          });
        // Built before any write, so an unknown drink is refused cleanly
        const plan = planFor(currentProducts);

        if (decision.action === "append") {
          const expected = await buildRestockData(machineConfig, date, {
            mode: event === RESTOCK_EVENTS.clearout ? "clearout" : undefined,
            logRows: rows,
            machineProducts: currentProducts,
          });
          let appended;
          ({ header, appended } = await appendRows(
            logSheetId,
            header,
            buildRestockLogRows({
              batchId,
              previousBatchId: findPreviousBatchId(
                rows,
                machineConfig.label,
                date,
              ),
              visitDate: todayInVisitZone(),
              duration: body.duration || "",
              event,
              submittedSlots: slots,
              expectedSlots: expected.slots,
            }),
          ));
          // A Load appends the old batch's Clearout row and its own: both are the saga
          saga = appended;
        } else if (decision.overwrite) {
          await overwriteRows(logSheetId, header, saga, {
            Duration: body.duration || "",
            "Slot Data": rewriteSlotData(
              slots,
              parseSlotData(decision.row["Slot Data"]),
            ),
            Status: SAGA_STATUS.pending,
          });
        }

        await syncNayax(machineId, currentProducts, plan, planFor);
        await setStatus(logSheetId, header, saga, SAGA_STATUS.nayaxWritten);
      }

      if (event === RESTOCK_EVENTS.topoff)
        await zeroInventoryColumn(machineConfig);
      await setStatus(logSheetId, header, saga, SAGA_STATUS.complete);
    }

    return json({ success: true, message: "Restock complete" });
  } catch (error) {
    if (error.unknownProduct) return badRequest(error.message);
    if (
      error.alreadySubmitted ||
      error.clearoutRequiresLoad ||
      error.batchClearedOut
    )
      return conflict(error.message, error.existingEntryRow);
    console.error("restock-submit failed:", error);
    if (error.upstream) return upstreamError(error.message);
    return serverError();
  }
}
