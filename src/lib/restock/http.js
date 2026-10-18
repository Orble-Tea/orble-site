// HTTP responses for the restock routes. Statuses and messages live in
// errors.js; this file only serializes them.
import { ERRORS, RestockError } from "./errors.js";

/** A JSON response the browser must not cache. */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * The response for a thrown error: a RestockError answers with its own status
 * and message, plus details when it carries any; anything else is a generic 500.
 */
export function errorResponse(error) {
  if (error instanceof RestockError)
    return json(
      error.details
        ? { error: error.message, details: error.details }
        : { error: error.message },
      error.status,
    );
  return json({ error: ERRORS.internal.message }, ERRORS.internal.status);
}

/** The request body as JSON, or a 400 RestockError when it does not parse. */
export async function parseJson(request) {
  try {
    return await request.json();
  } catch {
    throw new RestockError(ERRORS.invalidJson);
  }
}
