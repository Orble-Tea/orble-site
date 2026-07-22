import {
  getMachineConfig,
  isMockMode,
  requireSecretKey,
} from "../../lib/restock/config.js";
import { badRequest, conflict, invalidKey, json, parseJson } from "../../lib/restock/http.js";
import { submitMockRestock } from "../../lib/restock/mock-service.js";
import { submitRestock } from "../../lib/restock/restock-service.js";

export async function POST({ request }) {
  try {
    const body = await parseJson(request);
    if (!requireSecretKey(body.key)) return invalidKey();

    const machineConfig = getMachineConfig(body.machine);
    if (!machineConfig || (!machineConfig.machineId && !isMockMode())) {
      return badRequest("Unknown machine");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || "")) return badRequest("Invalid date");
    if (!["Load", "Topoff"].includes(body.event)) return badRequest("Invalid event");
    if (!Array.isArray(body.slots)) return badRequest("Slots must be an array");

    if (isMockMode()) return json(submitMockRestock(body));

    const result = await submitRestock(body, machineConfig);
    if (result.conflict) {
      return conflict(
        `This ${body.event} has already been submitted.`,
        result.existingEntryUrl,
      );
    }

    return json(result);
  } catch (error) {
    console.error("restock-submit error:", error);
    return badRequest(error.message);
  }
}
