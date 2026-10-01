// @steered AudibleSecurityContext 1.2 2026-10-01
// Messages the restocker sees, shared by the routes, the page, and the tests.
export const MESSAGES = {
  retrySubmission: "Please retry submission.",
  restockSubmitted: "Restock submitted",
  alreadySubmitted: "This event was already submitted for this batch.",
  batchClearedOut: "This batch was already cleared out.",
  clearoutRequiresLoad: "Clearout requires a Load event for this batch.",
};

export const couldntSubmit = (reason) =>
  `Couldn't submit: ${reason} Your current draft is saved on page refreshes.`;

export const needsEventFirst = (next, event) =>
  `This batch needs a ${next} before a ${event}.`;

export class AlreadySubmittedError extends Error {
  constructor(message, existingEntryRow) {
    super(message);
    this.name = "AlreadySubmittedError";
    this.alreadySubmitted = true;
    this.existingEntryRow = existingEntryRow;
  }
}

export class ClearoutRequiresLoadError extends Error {
  constructor() {
    super(MESSAGES.clearoutRequiresLoad);
    this.name = "ClearoutRequiresLoadError";
    this.clearoutRequiresLoad = true;
  }
}

export class BatchClearedOutError extends Error {
  constructor() {
    super(MESSAGES.batchClearedOut);
    this.name = "BatchClearedOutError";
    this.batchClearedOut = true;
  }
}

export class UpstreamServiceError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "UpstreamServiceError";
    this.upstream = true;
    this.details = details;
  }
}
