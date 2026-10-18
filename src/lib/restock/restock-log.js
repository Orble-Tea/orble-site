// Pure builders for the Restock Log side of a submit: request validation, the
// log rows, the batch rules and the submit decision. The route does all the I/O.
import {
  getMachineConfig,
  getMachineSlots,
  RESTOCK_EVENTS,
  RESTOCK_LOG_HEADER,
} from "./config.js";
import { ERRORS, RestockError } from "./errors.js";
import { freeSpace, takesAllOut, totalAfter } from "./slot-validation-rules.js";
import {
  formatDrinkName,
  sameDrink,
  slotCapacityForDrinkParts,
} from "./drink-parsing.js";

const { BATCH_ID, EVENT, DATE, DURATION, SLOT_DATA, STATUS } =
  RESTOCK_LOG_HEADER;

/**
 * @typedef {{ flavor: string, size?: string, sweetness?: string, topping?: string }} DrinkParts
 * @typedef {{ drink: DrinkParts | null, previousDrink: string | null, previous: number, waste: number, new: number }} ExpectedSlot
 *   The prefill the page showed for a slot before any edits.
 * @typedef {{ slot: number, drink: DrinkParts | null, previousDrink: string | null, previous: number, waste: number, new: number, expected?: ExpectedSlot }} SubmittedSlot
 *   One slot as the page confirmed it: what is there now, what came out, what went in.
 * @typedef {Record<string, string>} LogRow
 *   A Restock Log row keyed by column name (RESTOCK_LOG_HEADER).
 * @typedef {Record<string, unknown>} SlotDataEntry
 *   One slot's entry in a row's Slot Data JSON; see slotEntry for the keys.
 */

// A submit's progress, in the Status column of its log row(s)
export const SUBMIT_STATUS = {
  NAYAX_PENDING: "Nayax pending",
  COMPLETE: "Complete",
};

/**
 * Checks one slot's counts and drink against the event's rules.
 * @param {string} event Load, Topoff or Clearout
 * @param {SubmittedSlot} slot
 * @returns {string | null} the first problem, or null when the slot is fine
 */
function validateSlot(event, slot) {
  const label = `slot ${slot.slot}`;
  for (const field of ["previous", "waste", "new"]) {
    if (!Number.isInteger(slot[field]) || slot[field] < 0)
      return `${label}: ${field} must be a non-negative integer`;
  }
  if (slot.waste > slot.previous)
    return `${label}: waste ${slot.waste} exceeds previous ${slot.previous}`;

  if (takesAllOut(event) && slot.waste !== slot.previous)
    return `${label}: a ${event} must take out all ${slot.previous} previous`;
  if (event === RESTOCK_EVENTS.CLEAROUT && slot.new > 0)
    return `${label}: a Clearout cannot add drinks`;
  if (
    event === RESTOCK_EVENTS.TOPOFF &&
    slot.drink?.flavor &&
    slot.previousDrink &&
    !sameDrink(slot.drink, slot.previousDrink)
  )
    return `${label}: a Topoff cannot change the drink`;

  // Nayax would drop the product while the log says drinks are left
  const total = totalAfter(slot.previous, slot.waste, slot.new);
  if (!slot.drink?.flavor && total > 0)
    return `${label}: a slot with no drink must end at 0, not ${total}`;

  const capacity = slotCapacityForDrinkParts(slot.drink || {});
  const free = freeSpace(slot.previous, slot.waste, event, capacity);
  if (slot.new > free)
    return `${label}: new ${slot.new} exceeds the ${free} free`;
  return null;
}

/**
 * Validates a POST body: required fields, a known machine, a batch id that
 * matches machine and date, a known event, every configured slot exactly once,
 * and each slot passing validateSlot. Throws the first problem as a RestockError.
 * Consistency with existing data is checked later.
 * @param {Record<string, any>} body the parsed request body
 * @returns {ReturnType<typeof getMachineConfig>} the machine the body names
 */
export function validateSubmission(body) {
  const required = ["batchId", "event", "machine", "date", "slots"];
  if (required.some((field) => !body[field]) || !Array.isArray(body.slots))
    throw new RestockError(ERRORS.missingFields);

  const machineConfig = getMachineConfig(body.machine);
  if (!machineConfig)
    throw new RestockError(ERRORS.unknownMachine(body.machine));
  const { event, date, batchId, slots } = body;
  if (batchId !== `${machineConfig.label}-${date}`)
    throw new RestockError(ERRORS.batchIdMismatch);

  const invalid = (problem) =>
    new RestockError(ERRORS.invalidSubmission(problem));
  if (!Object.values(RESTOCK_EVENTS).includes(event))
    throw invalid(`unknown event ${event}`);
  const machineSlots = getMachineSlots(machineConfig);
  const configured = new Set(machineSlots);
  const seen = new Set();
  for (const slot of slots) {
    if (seen.has(slot.slot))
      throw invalid(`slot ${slot.slot} appears more than once`);
    seen.add(slot.slot);
    if (!configured.has(slot.slot))
      throw invalid(`slot ${slot.slot} is not configured on this machine`);
  }
  for (const slot of machineSlots) {
    if (!seen.has(slot)) throw invalid(`slot ${slot} is missing`);
  }
  for (const slot of slots) {
    const problem = validateSlot(event, slot);
    if (problem) throw invalid(problem);
  }
  return machineConfig;
}

/**
 * The prefill a slot started from as Slot Data's Expected fields.
 * @param {ExpectedSlot | undefined} expected
 * @returns {SlotDataEntry} the Expected * keys only
 */
function expectedFields(expected) {
  return {
    "Expected Drink": formatDrinkName(expected?.drink) || null,
    "Expected Previous Drink": expected?.previousDrink ?? null,
    "Expected Previous": expected?.previous ?? 0,
    "Expected Waste": expected?.waste ?? 0,
    "Expected New": expected?.new ?? 0,
  };
}

/**
 * One slot's confirmed state next to the prefill it started from.
 * @param {SubmittedSlot} slot
 * @param {SlotDataEntry} [expected] the Expected * fields to carry over
 * @returns {SlotDataEntry}
 */
function slotEntry(slot, expected = {}) {
  return {
    Slot: slot.slot,
    Drink: formatDrinkName(slot.drink) || null,
    "Expected Drink": expected["Expected Drink"] ?? null,
    "Previous Drink": slot.previousDrink ?? null,
    "Expected Previous Drink": expected["Expected Previous Drink"] ?? null,
    Previous: slot.previous,
    "Expected Previous": expected["Expected Previous"] ?? 0,
    Waste: slot.waste,
    "Expected Waste": expected["Expected Waste"] ?? 0,
    New: slot.new,
    "Expected New": expected["Expected New"] ?? 0,
    Total: totalAfter(slot.previous, slot.waste, slot.new),
  };
}

/**
 * Restock Log rows for a submission. Every row carries every slot as JSON in
 * Slot Data. A Load writes a Clearout row closing the previous batch (when
 * there is one) and a Load row; a Topoff or a standalone Clearout writes one row.
 * @param {{ batchId: string, previousBatchId: string | null, visitDate: string, duration: string, event: string, submittedSlots: SubmittedSlot[], status: string }} input
 *   previousBatchId is the batch a Load closes out
 * @returns {LogRow[]} one or two rows
 */
export function buildRestockLogRows({
  batchId,
  previousBatchId,
  visitDate,
  duration = "",
  event,
  submittedSlots,
  status,
}) {
  const slotData = JSON.stringify(
    submittedSlots.map((slot) =>
      slotEntry(slot, expectedFields(slot.expected)),
    ),
  );
  const row = (rowBatchId, rowEvent) => ({
    [BATCH_ID]: rowBatchId,
    [EVENT]: rowEvent,
    [DATE]: visitDate,
    [DURATION]: duration,
    [SLOT_DATA]: slotData,
    [STATUS]: status,
  });
  if (event === RESTOCK_EVENTS.LOAD && previousBatchId)
    return [row(previousBatchId, RESTOCK_EVENTS.CLEAROUT), row(batchId, event)];
  return [row(batchId, event)];
}

/**
 * Slot Data for an edited resend: the new counts, the first attempt's Expected values.
 * @param {SubmittedSlot[]} submittedSlots
 * @param {SlotDataEntry[]} storedEntries the row's current Slot Data
 * @returns {string} the new Slot Data JSON
 */
export function rewriteSlotData(submittedSlots, storedEntries) {
  const storedBySlot = new Map(storedEntries.map((e) => [e.Slot, e]));
  return JSON.stringify(
    submittedSlots.map((slot) => slotEntry(slot, storedBySlot.get(slot.slot))),
  );
}

/**
 * Whether a request carries the same confirmed state as a stored submit.
 * @param {SubmittedSlot[]} submittedSlots
 * @param {SlotDataEntry[]} storedEntries the row's Slot Data
 * @returns {boolean}
 */
export function sameSlots(submittedSlots, storedEntries) {
  const fromRequest = submittedSlots.map((s) =>
    JSON.stringify([
      s.slot,
      formatDrinkName(s.drink) || null,
      s.previousDrink ?? null,
      s.previous,
      s.waste,
      s.new,
    ]),
  );
  const fromLog = storedEntries.map((e) =>
    JSON.stringify([
      e.Slot,
      e.Drink,
      e["Previous Drink"],
      e.Previous,
      e.Waste,
      e.New,
    ]),
  );
  return JSON.stringify(fromRequest.sort()) === JSON.stringify(fromLog.sort());
}

/**
 * The batch's latest row per event, from one bottom-up scan of the log. The
 * log is append-only, so today's rows sit at the bottom; an older duplicate
 * from a race is ignored.
 * @param {LogRow[]} rows the whole Restock Log, oldest first
 * @param {string} batchId
 * @returns {{ load?: LogRow, topoff?: LogRow, clearout?: LogRow }}
 */
export function getBatchLogRows(rows, batchId) {
  const found = {};
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row[BATCH_ID] !== batchId) continue;
    if (!(row[EVENT] in found)) found[row[EVENT]] = row;
  }
  return {
    load: found[RESTOCK_EVENTS.LOAD],
    topoff: found[RESTOCK_EVENTS.TOPOFF],
    clearout: found[RESTOCK_EVENTS.CLEAROUT],
  };
}

/**
 * This machine's last log row, or null. The log is append-only, so it is read
 * from the bottom.
 * @param {LogRow[]} rows the whole Restock Log, oldest first
 * @param {string} machineLabel
 * @returns {LogRow | null}
 */
export function lastMachineBatchEvent(rows, machineLabel) {
  const prefix = `${machineLabel}-`;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i][BATCH_ID].startsWith(prefix)) return rows[i];
  }
  return null;
}

/**
 * The batch rule a new event would break, or null when the batch can take it.
 * Shared by the page (which event to offer) and the submit (whether to write),
 * so the two cannot disagree.
 * @param {{ rows: LogRow[], batchRows: ReturnType<typeof getBatchLogRows>, machineLabel: string, batchId: string, event: string }} input
 *   rows is the whole Restock Log; batchRows is getBatchLogRows(rows, batchId)
 * @returns {{ error: { status: number, message: string }, details?: Record<string, unknown> } | null}
 *   details carries fields the page reads alongside the message
 */
export function batchRuleViolation({
  rows,
  batchRows,
  machineLabel,
  batchId,
  event,
}) {
  // The log says this batch was already cleared out and cannot have any more entries
  if (batchRows.clearout) return { error: ERRORS.batchClearedOut };

  // Check if there exists a newer batch date for this machine as there can only be one active batch at a time
  const last = lastMachineBatchEvent(rows, machineLabel);
  if (last && last[BATCH_ID] > batchId)
    return {
      error: ERRORS.batchSuperseded(last[BATCH_ID]),
      details: { newestBatchId: last[BATCH_ID] },
    };

  const loadDone =
    Boolean(batchRows.load) &&
    batchRows.load[STATUS] !== SUBMIT_STATUS.NAYAX_PENDING;
  // The requested event is a Topoff or Clearout, but this is not possible as there is no Load event for this batch
  if (event !== RESTOCK_EVENTS.LOAD && !loadDone)
    return { error: ERRORS.needsEventFirst(RESTOCK_EVENTS.LOAD, event) };
  return null;
}

/**
 * What a submit does given the Restock Log. The event's row for this batch
 * comes first, so a failed submit can always finish; only without one do the
 * batch rules apply.
 * @param {{ rows: LogRow[], machineLabel: string, batchId: string, event: string, submittedSlots: SubmittedSlot[] }} input
 *   rows is the whole Restock Log, oldest first
 * @returns {{ action: "append" }
 *   | { action: "resume", overwrite: boolean, preExistingEventRow: LogRow }
 *   | { action: "done", preExistingEventRow: LogRow }
 *   | { action: "reject", error: { status: number, message: string }, details?: Record<string, unknown> }}
 *   resume redoes the Nayax write; overwrite replaces the row's Slot Data
 *   first. done means already Complete with these slots.
 */
export function decideSubmitAction({
  rows,
  machineLabel,
  batchId,
  event,
  submittedSlots,
}) {
  const batchRows = getBatchLogRows(rows, batchId);
  const eventRow = batchRows[event.toLowerCase()];
  if (eventRow) {
    const same = sameSlots(
      submittedSlots,
      JSON.parse(eventRow[SLOT_DATA] || "[]"),
    );
    if (eventRow[STATUS] === SUBMIT_STATUS.NAYAX_PENDING)
      return {
        action: "resume",
        overwrite: !same,
        preExistingEventRow: eventRow,
      };
    return same
      ? { action: "done", preExistingEventRow: eventRow }
      : { action: "reject", error: ERRORS.alreadySubmitted };
  }

  const violation = batchRuleViolation({
    rows,
    batchRows,
    machineLabel,
    batchId,
    event,
  });
  return violation ? { action: "reject", ...violation } : { action: "append" };
}
