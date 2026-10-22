// Every error the restock routes can return, each with the HTTP status it
// carries, plus the copy the page shows. Shared by the routes, the lib, the
// page, and the tests so one definition owns each string.

/** The Inventory workbook names its tabs MM/DD/YYYY. */
export function inventoryTabName(date) {
  const [year, month, day] = date.split("-");
  return `${month}/${day}/${year}`;
}

/** Errors keyed by cause, each { status, message }. Entries with a parameter are functions returning one. */
export const ERRORS = {
  invalidKey: { status: 403, message: "Invalid RESTOCK_SECRET_KEY" },
  invalidJson: { status: 400, message: "Invalid JSON body" },
  missingFields: { status: 400, message: "Missing required fields" },
  invalidDate: { status: 400, message: "Invalid date" },
  invalidMode: { status: 400, message: "Invalid mode" },
  alreadySubmitted: {
    status: 409,
    message: "This event was already submitted for this batch.",
  },
  batchFullyLogged: {
    status: 409,
    message:
      "This batch was already loaded and topped off. Please check your batch date.",
  },
  batchClearedOut: {
    status: 409,
    message: "This batch was already cleared out.",
  },
  machineNotConfigured: { status: 500, message: "Machine is not configured" },
  internal: { status: 500, message: "Internal server error" },

  /** @returns {{ status: number, message: string }} */
  batchSuperseded: (newestBatchId) => ({
    status: 409,
    message: `This machine already has a newer batch, ${newestBatchId}. Pick that batch's date to restock it.`,
  }),
  /** @param {string} date YYYY-MM-DD, shown as the tab would be named */
  noInventoryForBatch: (date) => ({
    status: 409,
    message: `No Inventory tab named ${inventoryTabName(date)}. Add it, or pick a different batch's date.`,
  }),
  /**
   * @param {string} sheetName "Production Plan" or "Inventory tab MM/DD/YYYY"
   * @param {string} machineLabel
   * @param {{ name: string, reason: string }[]} rows rows with an amount for this machine whose drink the parser cannot read
   */
  sheetDrinksInvalid: (sheetName, machineLabel, rows) => ({
    status: 409,
    message: `${MESSAGES.invalidDrinksIntro(sheetName, machineLabel)} ${rows
      .map((row) => `${row.name} (${row.reason})`)
      .join(", ")}. ${MESSAGES.fixDrinkNames}`,
  }),
  /** @returns {{ status: number, message: string }} */
  unknownMachine: (name) => ({
    status: 400,
    message: name ? `Unknown machine: ${name}` : "Unknown machine",
  }),
  /** @returns {{ status: number, message: string }} */
  invalidSubmission: (problem) => ({ status: 400, message: problem }),
  /** @returns {{ status: number, message: string }} */
  needsEventFirst: (next, event) => ({
    status: 409,
    message: `This batch needs a ${next} before a ${event}.`,
  }),
  /** @returns {{ status: number, message: string }} */
  unknownProduct: (drinkName) => ({
    status: 400,
    message: `'${drinkName}' is not an active Nayax product. Add or reactivate it in Nayax, then submit again.`,
  }),
  /** @returns {{ status: number, message: string }} */
  incompleteProduct: (drinkName) => ({
    status: 400,
    message: `'${drinkName}' has no DEX name or prices in Nayax. Add them in Nayax, then submit again.`,
  }),
  appendRangeMissing: {
    status: 502,
    message: "Sheets append did not report its range",
  },
  logHeaderMissing: {
    status: 502,
    message: "Restock Log has no header row",
  },
  /** @returns {{ status: number, message: string }} */
  nayaxCreatedFewer: (created, requested) => ({
    status: 502,
    message: `Nayax created ${created} of ${requested} slots`,
  }),
};

/** Copy the page shows that is not a server error. */
export const MESSAGES = {
  restockSubmitted: "Restock submitted",
  retrySubmission: "Please retry submission.",
  invalidDrinksIntro: (sheetName, machineLabel) =>
    `${sheetName} has drinks that cannot be read for ${machineLabel}:`,
  fixDrinkNames: "Fix their names, then start again.",
};

/** Prefill warnings: the GET still answers 200; the page maps the code to its own text. */
export const WARNINGS = {
  missingNayaxProductName: (slot) =>
    `Slot ${slot} is configured in Nayax, but Nayax did not return a product name.`,
  unparsedNayaxProductName: (slot, productName, reason) =>
    `Slot ${slot} holds ${productName}, which is not a known drink (${reason}).`,
  missingNayaxOnHand: (slot, par) =>
    `Slot ${slot} has PAR ${par}, but Nayax did not return a readable on-hand count.`,
  openBatchClearedOut: (batchId) =>
    `Batch ${batchId} was never topped off. This Load clears it out.`,
  missingInventoryAllocationColumn: (machineLabel, header) =>
    `Inventory is missing an allocation column for ${machineLabel}. Expected a column equivalent to "${header}".`,
};

/** The hint under Complete when the server rejected the submit with a reason. */
export const couldntSubmit = (reason) =>
  `Couldn't submit: ${reason.endsWith(".") ? reason : `${reason}.`} Your current draft is saved on page refreshes.`;

/**
 * A refusal built from an ERRORS entry. The route answers with its status and
 * `{ error: message, details }`; details carries fields the page reads
 * alongside the message, e.g. newestBatchId, and is omitted when empty.
 */
export class RestockError extends Error {
  /**
   * @param {{ status: number, message: string }} error an ERRORS entry
   * @param {Record<string, unknown>} [details]
   */
  constructor(error, details) {
    super(error.message);
    this.name = "RestockError";
    this.status = error.status;
    this.details = details;
  }
}

/** A Nayax or Google Sheets call failed; answered as 502 with the call's details. */
export class UpstreamServiceError extends RestockError {
  constructor(message, details = {}) {
    super({ status: 502, message }, details);
    this.name = "UpstreamServiceError";
    this.upstream = true;
  }
}
