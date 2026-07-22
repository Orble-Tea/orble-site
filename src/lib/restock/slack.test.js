import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendPicklistSlack, sendRestockSlack } from "./slack.js";

describe("Slack notifications", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SLACK_WEBHOOK_URL;
  });

  it("skips Slack calls when no webhook is configured", async () => {
    await sendRestockSlack({ event: "Load", machine: "Towne", slots: [] }, 0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends restock summaries to the configured webhook", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://slack.test/webhook";
    fetch.mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await sendRestockSlack(
      {
        event: "Load",
        machine: "Towne",
        batchId: "Towne-2026-07-10",
        date: "2026-07-10",
        duration: "5m 32s",
        slots: [{ slot: 1 }],
      },
      2,
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://slack.test/webhook",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Load complete - Towne"),
      }),
    );
  });

  it("formats picklists by machine", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://slack.test/webhook";
    fetch.mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await sendPicklistSlack({
      date: "2026-07-10",
      machines: [
        { machine: "Towne", items: [{ drink: "Thai Tea 16oz", quantity: 6 }] },
        { machine: "30th", items: [] },
      ],
    });

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.text).toContain("Pick List - Jul 10");
    expect(body.text).toContain("Towne:");
    expect(body.text).toContain(" - 6 Thai Tea 16oz");
    expect(body.text).toContain("30th:");
    expect(body.text).toContain(" - Nothing to pick");
  });

  it("surfaces Slack webhook failures", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://slack.test/webhook";
    fetch.mockResolvedValueOnce(new Response("bad", { status: 500 }));

    await expect(
      sendRestockSlack({ event: "Load", machine: "Towne", slots: [] }, 0),
    ).rejects.toThrow("Slack webhook failed: bad");
  });
});
