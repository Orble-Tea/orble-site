export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export function invalidKey() {
  return json({ error: "Invalid RESTOCK_SECRET_KEY" }, 403);
}

export function badRequest(message) {
  return json({ error: message }, 400);
}

export function conflict(message, existingEntryRow, existingEntryUrl) {
  return json(
    {
      error: message,
      existingEntryRow,
      ...(existingEntryUrl ? { existingEntryUrl } : {}),
    },
    409,
  );
}

export function serverError(message = "Internal server error") {
  return json({ error: message }, 500);
}

export function upstreamError(message, details) {
  return json({ error: message, ...(details ? { details } : {}) }, 502);
}

export async function parseJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Invalid JSON body");
  }
}
