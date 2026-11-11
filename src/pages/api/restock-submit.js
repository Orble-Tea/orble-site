// Stub submit endpoint: validates the request and acknowledges.
// Nayax updates, Restock Log rows, Visits, and Slack land in a follow-up PR.
import { requireRestockSecretKey } from "../../lib/restock/config.js";
import {
  badRequest,
  invalidKey,
  json,
  parseJson,
} from "../../lib/restock/http.js";
import { RestockSubmitBody } from "../../lib/restock/schemas.js";

export async function POST({ request }) {
  let body;
  try {
    body = await parseJson(request);
  } catch {
    return badRequest("Invalid JSON body");
  }

  if (!requireRestockSecretKey(body.key)) return invalidKey();

  const parsed = RestockSubmitBody.safeParse(body);
  if (!parsed.success) {
    const missing = parsed.error.issues.some(
      (issue) =>
        issue.code === "invalid_type" &&
        /received undefined/.test(issue.message),
    );
    return badRequest(
      missing ? "Missing required fields" : "Invalid request body",
    );
  }

  return json({ success: true, message: "Restock complete" });
}
