export class AlreadySubmittedError extends Error {
  constructor(message, existingEntryRow) {
    super(message);
    this.name = "AlreadySubmittedError";
    this.alreadySubmitted = true;
    this.existingEntryRow = existingEntryRow;
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
