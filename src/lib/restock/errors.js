// Every error the restock routes can return, each with the HTTP status it
// carries, plus the copy the page shows. Shared by the routes, the lib, the
// page, and the tests so one definition owns each string.

/** @typedef {{ status: number, message: string }} ErrorSpec */

/** Errors keyed by cause. Entries with a parameter are functions returning the spec. */
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
  clearoutRequiresLoad: {
    status: 409,
    message: "Clearout requires a Load event for this batch.",
  },
  machineNotConfigured: { status: 500, message: "Machine is not configured" },
  internal: { status: 500, message: "Internal server error" },

  /** @returns {ErrorSpec} */
  unknownMachine: (name) => ({
    status: 400,
    message: name ? `Unknown machine: ${name}` : "Unknown machine",
  }),
  /** @returns {ErrorSpec} */
  invalidSubmission: (problem) => ({ status: 400, message: problem }),
  /** @returns {ErrorSpec} */
  needsEventFirst: (next, event) => ({
    status: 400,
    message: `This batch needs a ${next} before a ${event}.`,
  }),
  /** @returns {ErrorSpec} */
  unknownProduct: (drinkName) => ({
    status: 400,
    message: `'${drinkName}' is not set up as a Nayax product. Add it in Nayax, then submit again.`,
  }),
  /** @returns {ErrorSpec} */
  incompleteProduct: (drinkName) => ({
    status: 400,
    message: `'${drinkName}' has no DEX name or prices in Nayax. Add them in Nayax, then submit again.`,
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
 * An error the route answers with `spec.status` and `{ error: spec.message, ...extra }`.
 * `extra` carries fields the client reads alongside the message, e.g. existingEntryRow.
 */
export class RestockError extends Error {
  /** @param {ErrorSpec} spec */
  constructor(spec, extra = {}) {
    super(spec.message);
    this.name = "RestockError";
    this.status = spec.status;
    this.extra = extra;
  }
}

/** A Nayax or Google Sheets call failed; answered as 502 with the call's details. */
export class UpstreamServiceError extends RestockError {
  constructor(message, details = {}) {
    super({ status: 502, message }, details ? { details } : {});
    this.name = "UpstreamServiceError";
    this.upstream = true;
    this.details = details;
  }
}
