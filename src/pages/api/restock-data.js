import {
  getMachineConfig,
  requireRestockSecretKey,
} from "../../lib/restock/config.js";
import {
  badRequest,
  conflict,
  invalidKey,
  json,
  serverError,
  upstreamError,
} from "../../lib/restock/http.js";
import { buildRestockData } from "../../lib/restock/restock-service.js";

export async function GET({ url }) {
  try {
    if (!requireRestockSecretKey(url.searchParams.get("key"))) return invalidKey();

    const machineConfig = getMachineConfig(url.searchParams.get("machine"));
    if (!machineConfig) return badRequest("Unknown machine");

    const date = url.searchParams.get("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest("Invalid date");
    if (!machineConfig.machineId) return serverError("Machine is not configured");

    const requestedMode = url.searchParams.get("mode") || url.searchParams.get("event");
    if (requestedMode && String(requestedMode).toLowerCase() !== "clearout") {
      return badRequest("Invalid mode");
    }

    const data = await buildRestockData(machineConfig, date, {
      mode: requestedMode || null,
    });
    return json(data);
  } catch (error) {
    if (error.alreadySubmitted) {
      return conflict(error.message, error.existingEntryRow);
    }
    console.error("restock-data error:", error);
    if (error.upstream) {
      return upstreamError(error.message, error.details);
    }
    return serverError();
  }
}
