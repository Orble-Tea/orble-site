import {
  getMachineConfig,
  isMockMode,
  requireSecretKey,
} from "../../lib/restock/config.js";
import { badRequest, conflict, invalidKey, json } from "../../lib/restock/http.js";
import { buildMockRestockData } from "../../lib/restock/mock-service.js";
import { buildRestockData } from "../../lib/restock/restock-service.js";

export async function GET({ url }) {
  try {
    if (!requireSecretKey(url.searchParams.get("key"))) return invalidKey();

    const machineConfig = getMachineConfig(url.searchParams.get("machine"));
    if (!machineConfig) return badRequest("Unknown machine");
    if (!machineConfig.machineId && !isMockMode()) return badRequest("Unknown machine");

    const date = url.searchParams.get("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return badRequest("Invalid date");

    if (isMockMode()) return json(buildMockRestockData(machineConfig, date));

    const data = await buildRestockData(machineConfig, date);
    if (data.alreadySubmitted) {
      return conflict(
        "This event has already been submitted for this batch.",
        data.existingEntryUrl,
      );
    }

    return json(data);
  } catch (error) {
    console.error("restock-data error:", error);
    return badRequest(error.message);
  }
}
