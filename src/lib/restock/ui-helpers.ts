// Types, UI config, and pure slot logic for the restock page.
import { parseDrinkName } from "./drinks.js";
import {
  freeSpace,
  takesAllOut,
  totalAfter,
  wasteCeiling,
} from "./slot-validation-rules.js";

// Fields the backend may use for the planned new count, in priority order.
export const NEW_COUNT_FIELDS = ["new", "expectedNew"] as const;

// A slot object as sent by backend
export type ServerSlot = {
  slot: number;
  flavor: string | null;
  size: string | null;
  topping: string | null;
  sweetness: string | null;
  previousDrink: string | null;
  previous: number;
  waste: number;
  expectedNew?: number;
  new?: number;
};

export type Slot = ServerSlot & {
  newCount: number;
  approved: boolean;
  edited: boolean;
  // Backend warning code for this slot; each view maps it to its own message
  warning?: string;
};

// HTTP statuses the restock endpoints return; 409 is read by two views.
export const HTTP = {
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  CONFLICT: 409,
  SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
};

export const COLORS = {
  chipMutedText: "#d1d5db",
  chipMutedFill: "#f3f4f6",
  chipMutedBorder: "#e5e7eb",
  countMuted: "#9ca3af",
};

/** Reads the planned new count from whichever field the backend sent. */
export function plannedNew(s: ServerSlot): number {
  for (const field of NEW_COUNT_FIELDS) {
    const value = s[field];
    if (typeof value === "number") return value;
  }
  return 0;
}

export type EmptyCause = "retiring" | "soldout" | "unconfigured";

/**
 * A slot is empty when its total after all operations is zero, but the
 * reason why is specified in the cause.
 */
export function emptyState(event: string, s: Slot): EmptyCause | null {
  if (s.warning) return null;
  if (slotTotal(s, event) > 0) return null;
  if (event === "Load" && s.previousDrink && !s.flavor) return "retiring";
  if (s.flavor && s.previous === 0) return "soldout";
  return "unconfigured";
}

/** Any change of flavor, size, topping, or sweetness is a swap. */
export function isSwap(event: string, s: Slot): boolean {
  if (event !== "Load" || !s.previousDrink || !s.flavor) return false;
  const prev = parseDrinkName(s.previousDrink);
  return (
    [
      [prev.flavor, s.flavor],
      [prev.size, s.size],
      [prev.topping, s.topping],
      [prev.sweetness, s.sweetness],
    ] as const
  ).some(([before, after]) => (before || null) !== after);
}

/** HTML-escapes a string for template interpolation. */
export function esc(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ---- Count rules shared by the edit steppers, the table, and the POST ----

export type Counts = { previous: number; waste: number; newCount: number };

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high);

/** The previous count the form shows and sends. */
export function shownPrevious(c: Counts, event: string): number {
  return takesAllOut(event) ? c.waste : c.previous;
}

/** What the slot holds after the visit. */
export function slotTotal(c: Counts, event: string): number {
  return totalAfter(shownPrevious(c, event), c.waste, c.newCount);
}

/** How many new drinks fit: capacity minus what stays in the slot. */
export function newCeiling(c: Counts, event: string, capacity: number): number {
  return freeSpace(shownPrevious(c, event), c.waste, event, capacity);
}

/** Pulls new down after a count change so the slot never overfills. */
function fitNew(c: Counts, event: string, capacity: number): Counts {
  return {
    ...c,
    newCount: Math.min(c.newCount, newCeiling(c, event, capacity)),
  };
}

/**
 * Sets waste. On Topoff it is capped at the previous count; on Load and
 * Clearout previous follows it, since everything comes out.
 */
export function setWaste(
  c: Counts,
  value: number,
  event: string,
  capacity: number,
): Counts {
  return fitNew(
    { ...c, waste: clamp(value, 0, wasteCeiling(c.previous, event)) },
    event,
    capacity,
  );
}

/**
 * Sets previous. On Topoff it corrects the Nayax count in either direction
 * and pulls waste down with it; on Load and Clearout it moves waste.
 */
export function setPrevious(
  c: Counts,
  value: number,
  event: string,
  capacity: number,
): Counts {
  if (takesAllOut(event)) return setWaste(c, value, event, capacity);
  const previous = Math.max(value, 0);
  return fitNew(
    { ...c, previous, waste: Math.min(c.waste, previous) },
    event,
    capacity,
  );
}

/** Sets new, between 0 and the free space. */
export function setNew(
  c: Counts,
  value: number,
  event: string,
  capacity: number,
): Counts {
  return { ...c, newCount: clamp(value, 0, newCeiling(c, event, capacity)) };
}

/** Empty takes everything out and puts nothing in. */
export function emptyCounts(c: Counts, _event: string): Counts {
  return {
    previous: c.previous,
    waste: Math.max(c.waste, c.previous),
    newCount: 0,
  };
}

type SubmitSlot = {
  slot: number;
  drink: {
    flavor: string;
    size: string | null;
    topping: string | null;
    sweetness: string | null;
  } | null;
  previousDrink: string | null;
  previous: number;
  waste: number;
  new: number;
};

/** The POST shape for one slot: the full state the restocker confirmed. */
export function toSubmitSlot(
  s: Counts &
    Pick<
      ServerSlot,
      "slot" | "flavor" | "size" | "topping" | "sweetness" | "previousDrink"
    >,
  event: string,
): SubmitSlot {
  return {
    slot: s.slot,
    drink: s.flavor
      ? {
          flavor: s.flavor,
          size: s.size,
          topping: s.topping,
          sweetness: s.sweetness,
        }
      : null,
    previousDrink: s.previousDrink,
    previous: shownPrevious(s, event),
    waste: s.waste,
    new: s.newCount,
  };
}

/**
 * Normalizes a saved draft entry: drafts from before the rename carry
 * sweetnessLevel, and drafts from before the previous stepper carry no
 * previous (use the Nayax count) and may hold Topoff waste above it.
 */
export function restoreDraftEntry(
  draft: Record<string, any>,
  server: { previous: number },
  event: string,
): Record<string, any> {
  const { sweetnessLevel, ...entry } = draft;
  if (!("sweetness" in entry) && sweetnessLevel !== undefined)
    entry.sweetness = sweetnessLevel;
  entry.previous ??= server.previous;
  if (!takesAllOut(event) && typeof entry.waste === "number")
    entry.waste = Math.min(entry.waste, entry.previous);
  return entry;
}
