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
  return json({ error: "Invalid key" }, 403);
}

export function badRequest(message) {
  return json({ error: message }, 400);
}

export function conflict(message, existingEntryUrl) {
  return json({ error: message, existingEntryUrl }, 409);
}

export async function parseJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Invalid JSON body");
  }
}
