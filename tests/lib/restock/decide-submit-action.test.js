// Unit tests for decideSubmitAction: what a POST does with the batch's existing
// log rows, and the batch rules. Each rule is tested here once; the GET
// proves only that it calls the same helper.
import { describe, expect, it } from "vitest";
import { ERRORS } from "../../../src/lib/restock/errors.js";
import {
  SUBMIT_STATUS,
  buildRestockLogRows,
  decideSubmitAction,
} from "../../../src/lib/restock/restock-log.js";
import { MATCHA, expected, submitted } from "./fixtures.js";

describe("decideSubmitAction", () => {
  const BATCH = "30th-2026-07-10";
  const slots = [
    submitted({
      slotNumber: 1,
      drink: MATCHA,
      new: 3,
      expected: expected({ drink: MATCHA, new: 3 }),
    }),
  ];
  const storedSlotData = buildRestockLogRows({
    batchId: BATCH,
    previousBatchId: null,
    visitDate: "2026-07-10",
    duration: "1m 0s",
    event: "Load",
    submittedSlots: slots,
    status: SUBMIT_STATUS.NAYAX_PENDING,
  })[0]["Slot Data"];
  const edited = [submitted({ slotNumber: 1, drink: MATCHA, new: 2 })];

  // Log rows the way rowsToObjects returns them
  let rowNumber;
  const row = (
    batchId,
    event,
    status = SUBMIT_STATUS.COMPLETE,
    slotDataText = "[]",
  ) => ({
    _rowNumber: rowNumber++,
    "Batch ID": batchId,
    Event: event,
    "Slot Data": slotDataText,
    Status: status,
  });
  const decide = (event, makeRows, submittedSlots = slots) => {
    rowNumber = 2;
    const rows = makeRows();
    return {
      rows,
      decision: decideSubmitAction({
        rows,
        machineLabel: "30th",
        batchId: BATCH,
        event,
        submittedSlots,
      }),
    };
  };

  it("appends when the event has no row and the batch allows it", () => {
    expect(decide("Load", () => []).decision).toEqual({ action: "append" });
    expect(decide("Topoff", () => [row(BATCH, "Load")]).decision).toEqual({
      action: "append",
    });
    expect(
      decide("Load", () => [row("30th-2026-07-03", "Load")]).decision,
    ).toEqual({ action: "append" });
    expect(
      decide("Load", () => [row("Towne-2026-07-17", "Load")]).decision,
    ).toEqual({ action: "append" });
  });

  const rejections = [
    {
      name: "a batch that was already cleared out",
      event: "Topoff",
      rows: () => [row(BATCH, "Load"), row(BATCH, "Clearout")],
      expected: { action: "reject", error: ERRORS.batchClearedOut },
    },
    {
      name: "a batch older than the machine's newest Load",
      event: "Load",
      rows: () => [row("30th-2026-07-17", "Load")],
      expected: {
        action: "reject",
        error: ERRORS.batchSuperseded("30th-2026-07-17"),
        details: { newestBatchId: "30th-2026-07-17" },
      },
    },
    {
      name: "a Topoff before any Load",
      event: "Topoff",
      rows: () => [],
      expected: {
        action: "reject",
        error: ERRORS.needsEventFirst("Load", "Topoff"),
      },
    },
    {
      name: "a Clearout before any Load",
      event: "Clearout",
      rows: () => [],
      expected: {
        action: "reject",
        error: ERRORS.needsEventFirst("Load", "Clearout"),
      },
    },
    {
      name: "a Topoff while the Load is still unfinished",
      event: "Topoff",
      rows: () => [
        row(BATCH, "Load", SUBMIT_STATUS.NAYAX_PENDING, storedSlotData),
      ],
      expected: {
        action: "reject",
        error: ERRORS.needsEventFirst("Load", "Topoff"),
      },
    },
    {
      name: "a different submit for a Complete event",
      event: "Load",
      rows: () => [row(BATCH, "Load", SUBMIT_STATUS.COMPLETE, storedSlotData)],
      slots: edited,
      expected: { action: "reject", error: ERRORS.alreadySubmitted },
    },
  ];
  for (const c of rejections) {
    it(`rejects ${c.name}`, () => {
      expect(decide(c.event, c.rows, c.slots).decision).toEqual(c.expected);
    });
  }

  const resumes = [
    { slots, expected: { action: "resume", overwrite: false } },
    { slots: edited, expected: { action: "resume", overwrite: true } },
  ];
  for (const c of resumes) {
    it(`resumes a Nayax pending row${c.expected.overwrite ? " with the edited slots" : ""}`, () => {
      const { rows, decision } = decide(
        "Load",
        () => [row(BATCH, "Load", SUBMIT_STATUS.NAYAX_PENDING, storedSlotData)],
        c.slots,
      );
      expect(decision).toEqual({ ...c.expected, preExistingEventRow: rows[0] });
    });
  }

  it("treats a resend of a Complete submit as done, writing nothing", () => {
    const { rows, decision } = decide("Load", () => [
      row(BATCH, "Load", SUBMIT_STATUS.COMPLETE, storedSlotData),
    ]);
    expect(decision).toEqual({ action: "done", preExistingEventRow: rows[0] });
  });

  it("uses the latest row for the event when there are two", () => {
    const { rows, decision } = decide("Load", () => [
      row(BATCH, "Load", SUBMIT_STATUS.NAYAX_PENDING, storedSlotData),
      row(BATCH, "Load", SUBMIT_STATUS.NAYAX_PENDING, storedSlotData),
    ]);
    expect(decision.preExistingEventRow).toBe(rows[1]);
  });
});
