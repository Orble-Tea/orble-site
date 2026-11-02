// Draft persistence: entries survive screen off / reload, keyed by batch.
import { $payload, $slots, startedAt, setStartedAt } from "./runtime";
import { restoreDraftEntry } from "~/lib/restock/ui-helpers";

const draftKey = (payload = $payload.get()!) =>
  `restock-draft-${payload.batchId}-${payload.event}`;

/** Persists `data` for the current batch and event, with when the log was started. */
export function writeDraft(data: unknown) {
  try {
    localStorage.setItem(
      draftKey(),
      JSON.stringify({ ts: Date.now(), startedAt, data }),
    );
  } catch {
    /* storage full or blocked: the form still works, it just won't survive a reload */
  }
}

/** The saved `data` for the current batch and event, or null; restores the start time. */
export function readDraft(): any {
  try {
    const raw = localStorage.getItem(draftKey());
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (draft.startedAt) setStartedAt(draft.startedAt);
    return draft.data;
  } catch {
    return null; /* corrupt draft: start clean */
  }
}

/** Persists the current slot entries. */
export function saveDraft() {
  writeDraft(
    $slots.get().map((s) => ({
      slotNumber: s.slotNumber,
      previous: s.previous,
      waste: s.waste,
      newCount: s.newCount,
      approved: s.approved,
      edited: s.edited,
      flavor: s.flavor,
      size: s.size,
      topping: s.topping,
      sweetness: s.sweetness,
      previousDrink: s.previousDrink,
    })),
  );
}

/** Merges a saved draft into the freshly loaded slots, matching by slot number. */
export function restoreDraft() {
  const data = readDraft();
  if (!Array.isArray(data)) return;
  const bySlot = new Map<number, Record<string, any>>(
    data.map((d: any) => [d.slotNumber, d]),
  );
  $slots.set(
    $slots.get().map((s) => {
      const d = bySlot.get(s.slotNumber);
      return d
        ? { ...s, ...restoreDraftEntry(d, s, $payload.get()!.event) }
        : s;
    }),
  );
}

/** Removes the draft after a successful submit, keyed by the submitted batch. */
export function clearDraft(payload = $payload.get()!) {
  try {
    localStorage.removeItem(draftKey(payload));
  } catch {
    /* ignore */
  }
}
