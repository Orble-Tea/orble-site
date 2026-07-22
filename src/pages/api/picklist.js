import { isMockMode, requireSecretKey } from "../../lib/restock/config.js";
import { badRequest, invalidKey, json } from "../../lib/restock/http.js";
import { buildMockPicklist } from "../../lib/restock/mock-service.js";
import { buildPicklist } from "../../lib/restock/restock-service.js";

export async function GET({ url }) {
  try {
    if (!requireSecretKey(url.searchParams.get("key"))) return invalidKey();

    const date = url.searchParams.get("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return badRequest("Invalid date");

    if (isMockMode()) return json(buildMockPicklist(date));

    return json(await buildPicklist(date));
  } catch (error) {
    console.error("picklist error:", error);
    return badRequest(error.message);
  }
}
