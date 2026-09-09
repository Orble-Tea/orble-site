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
    super("Clearout requires a Load event for this batch.");
    this.name = "ClearoutRequiresLoadError";
    this.clearoutRequiresLoad = true;
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
