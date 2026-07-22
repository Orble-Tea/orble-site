function monthDay(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

async function sendSlackText(text) {
  if (!process.env.SLACK_WEBHOOK_URL) return;

  const response = await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed: ${await response.text()}`);
  }
}

export async function sendPicklistSlack(picklist) {
  const lines = [`Pick List - ${monthDay(picklist.date)}`, ""];
  for (const machine of picklist.machines) {
    lines.push(`${machine.machine}:`);
    if (!machine.items.length) lines.push(" - Nothing to pick");
    for (const item of machine.items) {
      lines.push(` - ${item.quantity} ${item.drink}`);
    }
    lines.push("");
  }

  await sendSlackText(lines.join("\n").trim());
}

export async function sendRestockSlack(payload, logRowCount) {
  await sendSlackText(
    [
      `${payload.event} complete - ${payload.machine}`,
      `Batch: ${payload.batchId}`,
      `Date: ${payload.date}`,
      `Duration: ${payload.duration || "Not provided"}`,
      `Slots submitted: ${(payload.slots || []).length}`,
      `Restock log rows written: ${logRowCount}`,
    ].join("\n"),
  );
}
