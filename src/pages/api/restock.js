// /api/restock. GET builds the form for a machine and batch date: which event
// comes next and the slot prefill. POST submits the confirmed form, tracked in
// the Restock Log: a Nayax pending row first, then Nayax, then the row's Status
// to Complete. A resend finds the row and finishes from where the last attempt
// stopped.
import {
  assertConfigured,
  getMachineConfig,
  MACHINE_CONFIG,
  requireRestockSecretKey,
  RESTOCK_EVENTS,
  RESTOCK_LOG_HEADER,
  RESTOCK_LOG_SHEET,
  SHEET_IDS,
} from "../../lib/restock/config.js";
import {
  appendSheetValues,
  columnLetter,
  toSheetRow,
  updateSheetValues,
} from "../../lib/restock/google-sheets.js";
import { errorResponse, json, parseJson } from "../../lib/restock/http.js";
import {
  ERRORS,
  RestockError,
  UpstreamServiceError,
} from "../../lib/restock/errors.js";
import { totalAfter } from "../../lib/restock/slot-validation-rules.js";
import { canonicalDrinkKeyFromParts } from "../../lib/restock/drinks.js";
import {
  createMachineProducts,
  getMachine,
  getMachineProducts,
  getOperatorProducts,
  putMachineProducts,
} from "../../lib/restock/nayax.js";
import { buildRestockData } from "../../lib/restock/restock-prefill.js";
import { readRestockLog } from "../../lib/restock/restock-sheets.js";
import {
  buildRestockLogRows,
  decideSubmitAction,
  lastLoadBatchId,
  rewriteSlotData,
  SUBMIT_STATUS,
  validateSubmission,
} from "../../lib/restock/restock-log.js";
import {
  buildNayaxCatalog,
  buildNayaxUpdate,
  isCompleteProduct,
  lookupProduct,
  nayaxSlotsToCreate,
} from "../../lib/restock/nayax-plan.js";

/**
 * The restock form for a machine and batch date: the next event and its slot
 * prefill, or a stored Nayax pending submit. Query: key, machine, date,
 * optional mode=clearout.
 * @param {{ url: URL }} context
 * @returns {Promise<Response>} the form JSON, or a 4xx with the reason
 */
export async function GET({ url }) {
  try {
    if (!requireRestockSecretKey(url.searchParams.get("key")))
      throw new RestockError(ERRORS.invalidKey);

    const machineConfig = getMachineConfig(url.searchParams.get("machine"));
    if (!machineConfig) throw new RestockError(ERRORS.unknownMachine());

    const date = url.searchParams.get("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new RestockError(ERRORS.invalidDate);
    if (!machineConfig.machineId)
      throw new RestockError(ERRORS.machineNotConfigured);

    const requestedMode =
      url.searchParams.get("mode") || url.searchParams.get("event");
    if (requestedMode && String(requestedMode).toLowerCase() !== "clearout")
      throw new RestockError(ERRORS.invalidMode);

    const data = await buildRestockData(machineConfig, date, {
      mode: requestedMode || null,
    });
    return json(data);
  } catch (error) {
    // 4xx are the restocker's to fix; anything else is ours to look at
    if (!(error instanceof RestockError) || error.status >= 500)
      console.error("restock GET error:", error);
    return errorResponse(error);
  }
}

const { BATCH_ID, EVENT, DURATION, SLOT_DATA, STATUS } = RESTOCK_LOG_HEADER;

/**
 * The operator's catalog with DEX names and prices borrowed from this
 * machine's slots. The other machines' slots are read only when a submitted
 * drink still lacks a DEX name or price. The operator ID comes from the
 * machine record.
 * @param {(typeof MACHINE_CONFIG)[number]} machineConfig the machine being restocked
 * @param {object[]} currentProducts this machine's Nayax products, as GET /machineProducts returns them
 * @param {import("../../lib/restock/restock-log.js").DrinkParts[]} drinks every drink in the submission
 * @returns {Promise<ReturnType<typeof buildNayaxCatalog>>} drink key -> product
 */
async function loadCatalog(machineConfig, currentProducts, drinks) {
  const machine = await getMachine(machineConfig.machineId);
  const operatorId = machine?.OperatorActorID ?? machine?.ActorID;
  const catalogProducts = await getOperatorProducts(operatorId);
  const catalog = buildNayaxCatalog(catalogProducts, currentProducts);
  const incomplete = drinks.some((drink) => {
    const entry = catalog.get(canonicalDrinkKeyFromParts(drink));
    return entry && !isCompleteProduct(entry);
  });
  if (!incomplete) return catalog;
  const others = await Promise.all(
    MACHINE_CONFIG.filter(
      (other) => other.machineId && other !== machineConfig,
    ).map((other) => getMachineProducts(other.machineId)),
  );
  return buildNayaxCatalog(catalogProducts, [
    ...currentProducts,
    ...others.flat(),
  ]);
}

/**
 * Submits a confirmed restock. Validates, decides from the Restock Log what
 * this press does, writes the log row(s) as Nayax pending, writes Nayax, then
 * marks the row(s) Complete. A resend finishes from where the last press
 * stopped. Body: { key, batchId, event, machine, date, duration, slots }.
 * @param {{ request: Request }} context
 * @returns {Promise<Response>} 200 on success, 4xx with the reason, 502 when
 *   Sheets or Nayax failed
 */
export async function POST({ request }) {
  try {
    const body = await parseJson(request);
    if (!requireRestockSecretKey(body.key))
      throw new RestockError(ERRORS.invalidKey);
    const machineConfig = validateSubmission(body);
    const { event, date, batchId, slots } = body;

    const logSheetId = assertConfigured(
      SHEET_IDS.restockLog,
      "RESTOCK_LOG_SHEET_ID",
    );
    const { header, rows } = await readRestockLog();
    const decision = decideSubmitAction({
      rows,
      machineLabel: machineConfig.label,
      batchId,
      event,
      submittedSlots: slots,
    });
    if (decision.action === "reject")
      throw new RestockError(decision.error, decision.details);

    if (decision.action !== "done") {
      const { machineId } = machineConfig;
      const currentProducts = await getMachineProducts(machineId);
      const nayaxSlots = slots.map((slot) => ({
        slot: slot.slot,
        drink: slot.drink,
        total: totalAfter(slot.previous, slot.waste, slot.new),
      }));
      const drinks = nayaxSlots.flatMap(({ drink }) =>
        drink?.flavor ? [drink] : [],
      );
      const catalog = await loadCatalog(machineConfig, currentProducts, drinks);
      // Refused before any write, so an unusable drink leaves nothing behind
      for (const drink of drinks) lookupProduct(catalog, drink);
      const toCreate = nayaxSlotsToCreate({
        currentProducts,
        catalog,
        slots: nayaxSlots,
      });

      let rowsToUpsert;
      if (decision.action === "append") {
        const newRows = buildRestockLogRows({
          batchId,
          // The batch rules passed, so the newest Load is older than this batch
          previousBatchId: lastLoadBatchId(rows, machineConfig.label),
          visitDate: new Date().toISOString().slice(0, 10),
          duration: body.duration || "",
          event,
          submittedSlots: slots,
          status: SUBMIT_STATUS.NAYAX_PENDING,
        });
        const firstRowNumber = await appendSheetValues(
          logSheetId,
          RESTOCK_LOG_SHEET,
          newRows.map((row) => toSheetRow(header, row)),
          "RAW",
        );
        rowsToUpsert = newRows.map((row, index) => ({
          ...row,
          _rowNumber: firstRowNumber + index,
        }));
      } else {
        // A Load's Clearout row for the old batch was appended just above its own row
        const { preExistingEventRow } = decision;
        const preExistingClearoutRow =
          preExistingEventRow[EVENT] === RESTOCK_EVENTS.LOAD &&
          rows.find(
            (row) =>
              row._rowNumber === preExistingEventRow._rowNumber - 1 &&
              row[EVENT] === RESTOCK_EVENTS.CLEAROUT &&
              row[BATCH_ID].startsWith(`${machineConfig.label}-`),
          );
        rowsToUpsert = preExistingClearoutRow
          ? [preExistingClearoutRow, preExistingEventRow]
          : [preExistingEventRow];
        if (decision.overwrite) {
          const changes = {
            [DURATION]: body.duration || "",
            [SLOT_DATA]: rewriteSlotData(
              slots,
              JSON.parse(preExistingEventRow[SLOT_DATA] || "[]"),
            ),
            [STATUS]: SUBMIT_STATUS.NAYAX_PENDING,
          };
          await updateSheetValues(
            logSheetId,
            RESTOCK_LOG_SHEET,
            `A${rowsToUpsert[0]._rowNumber}:${columnLetter(header.length - 1)}${rowsToUpsert.at(-1)._rowNumber}`,
            rowsToUpsert.map((row) =>
              toSheetRow(header, { ...row, ...changes }),
            ),
            "RAW",
          );
        }
      }

      let created = [];
      if (toCreate.length > 0) {
        created = await createMachineProducts(machineId, toCreate);
        if (created.length !== toCreate.length)
          throw new UpstreamServiceError(
            ERRORS.nayaxCreatedFewer(created.length, toCreate.length).message,
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
      // The submit's rows are adjacent, so one range covers them
      const statusColumn = columnLetter(header.indexOf(STATUS));
      await updateSheetValues(
        logSheetId,
        RESTOCK_LOG_SHEET,
        `${statusColumn}${rowsToUpsert[0]._rowNumber}:${statusColumn}${rowsToUpsert.at(-1)._rowNumber}`,
        rowsToUpsert.map(() => [SUBMIT_STATUS.COMPLETE]),
        "RAW",
      );
    }

    return json({ success: true, message: "Restock complete" });
  } catch (error) {
    // 4xx are the restocker's to fix; anything else is ours to look at
    if (!(error instanceof RestockError) || error.status >= 500)
      console.error("restock POST error:", error);
    return errorResponse(error);
  }
}
