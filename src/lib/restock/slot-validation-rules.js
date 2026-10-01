// Count rules shared by the restock page (steppers) and the submit route
// (validation), so the two cannot drift apart.

export const RESTOCK_EVENTS = {
  load: "Load",
  topoff: "Topoff",
  clearout: "Clearout",
};

/** Load and Clearout take the whole old batch out of the slot. */
export function takesAllOut(event) {
  return event === RESTOCK_EVENTS.load || event === RESTOCK_EVENTS.clearout;
}

/** What the slot holds after the visit. */
export function totalAfter(previous, waste, newCount) {
  return previous - waste + newCount;
}

/** How many new drinks fit: capacity minus what stays in the slot. A Clearout adds none. */
export function freeSpace(previous, waste, event, capacity) {
  if (event === RESTOCK_EVENTS.clearout) return 0;
  return Math.max(capacity - (previous - waste), 0);
}

/** The most waste allowed: all of previous on Topoff; unbounded on Load and Clearout, where previous follows waste. */
export function wasteCeiling(previous, event) {
  return takesAllOut(event) ? Infinity : previous;
}
