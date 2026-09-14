// Types, UI config, and pure slot logic for the restock page.
import { parseDrinkName } from "./drinks.js";

// Fields the backend may use for the planned new count, in priority order.
export const NEW_COUNT_FIELDS = ["new", "expectedNew"] as const;

// A slot object as sent by backend
export type ServerSlot = {
  slot: number;
  flavor: string | null;
  size: string | null;
  topping: string | null;
  sweetnessLevel: string | null;
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
  warning?: string;
};

// HTTP statuses the restock endpoints return; 409 is read by two views.
export const HTTP = {
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
  if (Math.max(s.previous, s.waste) - s.waste + s.newCount > 0) return null;
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
      [prev.sweetness, s.sweetnessLevel],
    ] as const
  ).some(([before, after]) => (before || null) !== after);
}

/** HTML-escapes a string for template interpolation. */
export function esc(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
