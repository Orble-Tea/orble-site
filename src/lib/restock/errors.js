// Every error the restock routes can return, each with the HTTP status it
// carries, plus the copy the page shows. Shared by the routes, the lib, the
// page, and the tests so one definition owns each string.

/** Errors keyed by cause, each { status, message }. Entries with a parameter are functions returning one. */
export const ERRORS = {
  invalidKey: { status: 403, message: "Invalid RESTOCK_SECRET_KEY" },
  invalidJson: { status: 400, message: "Invalid JSON body" },
  missingFields: { status: 400, message: "Missing required fields" },
  invalidDate: { status: 400, message: "Invalid date" },
  invalidMode: { status: 400, message: "Invalid mode" },
  batchIdMismatch: {
    status: 400,
    message: "batchId does not match the machine and date",
  },
  alreadySubmitted: {
    status: 409,
    message: "This event was already submitted for this batch.",
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
