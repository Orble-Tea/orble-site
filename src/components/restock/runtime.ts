// Shared client runtime for anything crossing view boundaries
import { atom } from "nanostores";
import type { ServerSlot, Slot } from "~/lib/restock/ui-helpers";

export const KEY = new URLSearchParams(location.search).get("key") || "";
export const $ = (id: string) => document.getElementById(id)!;

export type RestockPayload = {
  batchId: string;
  event: string;
  machine: string;
  date: string;
  warnings?: { slot: number; code: string }[];
  slots: ServerSlot[];
};

export const $payload = atom<RestockPayload | null>(null);
export const $slots = atom<Slot[]>([]);
export const $showErrors = atom(false);

export let startedAt = 0;

/** Records when the current log was started, for the visit duration. */
export function setStartedAt(t: number) {
  startedAt = t;
}

/** Updates changed fields only, to one slot at a time. */
export function updateSlot(i: number, patch: Partial<Slot>) {
  $slots.set($slots.get().map((s, j) => (j === i ? { ...s, ...patch } : s)));
}

// Registered by edit-view; called by table-view's edit-button handler.
export const hooks = {
  openEdit: (_i: number) => {},
};

const VIEWS = ["start", "table", "edit", "submitted"];

/** Shows one view section and hides the other three. */
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
