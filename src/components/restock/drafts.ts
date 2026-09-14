// Draft persistence: entries survive screen off / reload, keyed by batch.
import { $payload, $slots, startedAt, setStartedAt } from "./runtime";

/** Persists the current slot entries to localStorage, keyed by batch and event. */
export function saveDraft() {
  const data = $slots.get().map((s) => ({
    slot: s.slot,
    waste: s.waste,
    newCount: s.newCount,
    approved: s.approved,
    edited: s.edited,
    flavor: s.flavor,
    size: s.size,
    topping: s.topping,
    sweetnessLevel: s.sweetnessLevel,
  }));
  try {
    localStorage.setItem(
      `restock-draft-${$payload.get()!.batchId}-${$payload.get()!.event}`,
      JSON.stringify({ ts: Date.now(), startedAt, data }),
    );
  } catch {
    /* storage full or blocked: the form still works, it just won't survive a reload */
  }
}

/** Merges a saved draft into the freshly loaded slots, matching by slot number. */
export function restoreDraft() {
  try {
    const raw = localStorage.getItem(
      `restock-draft-${$payload.get()!.batchId}-${$payload.get()!.event}`,
    );
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (draft.startedAt) setStartedAt(draft.startedAt);
    const bySlot = new Map(draft.data.map((d: any) => [d.slot, d]));
    $slots.set(
      $slots.get().map((s) => {
        const d = bySlot.get(s.slot);
        return d ? { ...s, ...d } : s;
      }),
    );
  } catch {
    /* corrupt draft: start clean */
  }
}

/** Removes the draft after a successful submit. */
export function clearDraft() {
  try {
    localStorage.removeItem(
      `restock-draft-${$payload.get()!.batchId}-${$payload.get()!.event}`,
    );
  } catch {
    /* ignore */
  }
}
