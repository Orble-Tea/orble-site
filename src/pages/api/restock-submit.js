// Stub submit endpoint: validates the request and acknowledges.
// Nayax updates, Restock Log rows, Visits, and Slack land in a follow-up PR.
import { requireRestockSecretKey } from "../../lib/restock/config.js";
import {
  badRequest,
  invalidKey,
  json,
  parseJson,
} from "../../lib/restock/http.js";

export async function POST({ request }) {
  let body;
  try {
    body = await parseJson(request);
  } catch {
    return badRequest("Invalid JSON body");
  }

  if (!requireRestockSecretKey(body.key)) return invalidKey();

  const required = ["batchId", "event", "machine", "date", "slots"];
  const missing = required.filter((field) => !body[field]);
  if (missing.length > 0 || !Array.isArray(body.slots)) {
    return badRequest("Missing required fields");
  }

  return json({ success: true, message: "Restock complete" });
}
