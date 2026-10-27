// Shared client runtime for anything crossing view boundaries
import { atom } from "nanostores";
import { HTTP, type ServerSlot, type Slot } from "~/lib/restock/ui-helpers";
import { ERRORS, MESSAGES, couldntSubmit } from "~/lib/restock/errors.js";

export const KEY = new URLSearchParams(location.search).get("key") || "";
export const $ = (id: string) => document.getElementById(id)!;

export type SplitDrink = {
  drink: string;
  storage: number;
  to30th: number;
  toTowne: number;
};

export type RestockPayload = {
  batchId: string;
  event: string;
  machine: string;
  date: string;
  warnings?: {
    slot?: number;
    code: string;
    reason?: string;
    message?: string;
    batchId?: string;
  }[];
  slots: ServerSlot[];
  drinks?: SplitDrink[];
};

export const $payload = atom<RestockPayload | null>(null);
export const $slots = atom<Slot[]>([]);
export const $showErrors = atom(false);

export let startedAt = 0;

/** Records when the current log was started, for the visit duration. */
export function setStartedAt(t: number) {
  startedAt = t;
}

/** Time since the log was started, as the log's "3m 12s" duration string. */
export function durationSinceStart(): string {
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Bob waves over the page while a submit is in flight (overlay lives in start-view). */
export function showSubmitting(button: HTMLButtonElement, on: boolean) {
  const overlay = document.getElementById("loading-overlay");
  if (!overlay) return;
  if (on) document.getElementById("loading-label")!.textContent = "Submitting…";
  overlay.classList.replace(on ? "hidden" : "flex", on ? "flex" : "hidden");
  button.disabled = on;
}

/**
 * Posts a log to the API. Resolves to null on success, else the hint to show
 * under the button: 400 and 409 carry a reason written for the restocker
 * (e.g. a drink not set up in Nayax yet); anything else is safe to retry.
 */
export async function postRestock(
  body: Record<string, unknown>,
): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch("/api/restock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: KEY, ...body }),
    });
  } catch {
    return MESSAGES.retrySubmission;
  }
  if (response.ok) return null;
  const error = await response.json().catch(() => ({}));
  const reason = typeof error.error === "string" ? error.error : null;
  return response.status === HTTP.CONFLICT
    ? reason || ERRORS.alreadySubmitted.message
    : response.status === HTTP.BAD_REQUEST && reason
      ? couldntSubmit(reason)
      : MESSAGES.retrySubmission;
}

/** Updates changed fields only, to one slot at a time. */
export function updateSlot(i: number, patch: Partial<Slot>) {
  $slots.set($slots.get().map((s, j) => (j === i ? { ...s, ...patch } : s)));
}

// Registered by edit-view; called by table-view's edit-button handler.
export const hooks = {
  openEdit: (_i: number) => {},
};

const VIEWS = ["start", "table", "split", "edit", "submitted"];

/** Shows one view section and hides the others. */
export function showView(name: string) {
  for (const v of VIEWS) $(`view-${v}`).classList.toggle("hidden", v !== name);
  window.scrollTo(0, 0);
}

/**
 * Switches views through the History API: forward transitions push an
 * entry so the phone's back button walks edit -> table -> start instead
 * of leaving the page entirely.
 */
export function navigate(name: string, replace = false) {
  const state = { view: name };
  if (replace) history.replaceState(state, "");
  else history.pushState(state, "");
  showView(name);
}

/**
 * Backs out of the edit view via history so the entry is consumed and
 * back from the table never lands on a stale edit form.
 */
export function closeEdit() {
  if (history.state?.view === "edit") history.back();
  else showView("table");
}

history.replaceState({ view: "start" }, "");
window.addEventListener("popstate", (e) => {
  const view = (e.state as { view?: string } | null)?.view;
  if (!view || !$payload.get()) return showView("start");
  if (view === "edit") return showView("table"); // never re-enter a popped edit form
  showView(view);
});
