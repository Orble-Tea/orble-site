// Submits a confirmed restock as a saga tracked in the Restock Log: a
// Pending row first, then Nayax, then the row's Status to Complete. A resend
// finds the row and finishes from where the last attempt stopped.
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
  readSheetValues,
  rowsToObjects,
  updateSheetValues,
} from "../../lib/restock/google-sheets.js";
import { errorResponse, json, parseJson } from "../../lib/restock/http.js";
import {
  ERRORS,
  RestockError,
  UpstreamServiceError,
} from "../../lib/restock/errors.js";
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
  hasDrink,
  lookupProduct,
  nayaxSlotsToCreate,
  parseSlotData,
  RESTOCK_LOG_HEADER,
  rewriteSlotData,
  SAGA_STATUS,
  toSheetRow,
  validateSubmission,
} from "../../lib/restock/submit-service.js";

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

export async function POST({ request }) {
  try {
    const body = await parseJson(request);
    if (!requireRestockSecretKey(body.key))
      throw new RestockError(ERRORS.invalidKey);

    const required = ["batchId", "event", "machine", "date", "slots"];
    const missing = required.filter((field) => !body[field]);
    if (missing.length > 0 || !Array.isArray(body.slots))
      throw new RestockError(ERRORS.missingFields);

    const machineConfig = getMachineConfig(body.machine);
    if (!machineConfig)
      throw new RestockError(ERRORS.unknownMachine(body.machine));
    const { event, date, batchId, slots } = body;
    if (batchId !== `${machineConfig.label}-${date}`)
      throw new RestockError(ERRORS.batchIdMismatch);

    const problem = validateSubmission({
      event,
      slots,
      machineSlots: getMachineSlots(machineConfig),
    });
    if (problem) throw new RestockError(ERRORS.invalidSubmission(problem));

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
    if (decision.action === "reject") throw new RestockError(decision.error);

    if (decision.action !== "done") {
      let saga = decision.row && sagaRows(rows, decision.row);
      const { machineId } = machineConfig;
      const currentProducts = await getMachineProducts(machineId);
      const catalog = await loadCatalog(machineConfig, currentProducts);
      const nayaxSlots = slots.map((slot) => ({
        slot: slot.slot,
        drink: slot.drink,
        total: totalAfter(slot.previous, slot.waste, slot.new),
      }));
      // Refused before any write, so an unusable drink leaves nothing behind
      for (const { drink } of nayaxSlots)
        if (hasDrink(drink)) lookupProduct(catalog, drink);
      const toCreate = nayaxSlotsToCreate({
        currentProducts,
        catalog,
        slots: nayaxSlots,
      });

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
            visitDate: new Date().toISOString().slice(0, 10),
            duration: body.duration || "",
            event,
            submittedSlots: slots,
            expectedSlots: expected.slots,
            status: SAGA_STATUS.pending,
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

      let created = [];
      if (toCreate.length > 0) {
        created = await createMachineProducts(machineId, toCreate);
        if (created.length !== toCreate.length)
          throw new UpstreamServiceError(
            `Nayax created ${created.length} of ${toCreate.length} slots`,
            { service: "nayax", operation: "create_machine_products" },
          );
      }
      // The PUT needs the IDs Nayax assigned on create, so the created records join the list
      const put = buildNayaxUpdate({
        currentProducts: [...currentProducts, ...created],
        catalog,
        slots: nayaxSlots,
      });
      if (put) await putMachineProducts(machineId, put, { avoidDelete: false });
      await setStatus(logSheetId, header, saga, SAGA_STATUS.complete);
    }

    return json({ success: true, message: "Restock complete" });
  } catch (error) {
    // 4xx are the restocker's to fix; anything else is ours to look at
    if (!(error instanceof RestockError) || error.status >= 500)
      console.error("restock-submit failed:", error);
    return errorResponse(error);
  }
}
