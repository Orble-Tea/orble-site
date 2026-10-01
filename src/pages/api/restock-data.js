import {
  getMachineConfig,
  requireRestockSecretKey,
} from "../../lib/restock/config.js";
import { ERRORS, RestockError } from "../../lib/restock/errors.js";
import { errorResponse, json } from "../../lib/restock/http.js";
import { buildRestockData } from "../../lib/restock/restock-service.js";

export async function GET({ url }) {
  try {
    if (!requireRestockSecretKey(url.searchParams.get("key")))
      throw new RestockError(ERRORS.invalidKey);

    const machineConfig = getMachineConfig(url.searchParams.get("machine"));
    if (!machineConfig) throw new RestockError(ERRORS.unknownMachine());

    const date = url.searchParams.get("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new RestockError(ERRORS.invalidDate);
    if (!machineConfig.machineId)
      throw new RestockError(ERRORS.machineNotConfigured);

    const requestedMode = url.searchParams.get("mode") || url.searchParams.get("event");
    if (requestedMode && String(requestedMode).toLowerCase() !== "clearout")
      throw new RestockError(ERRORS.invalidMode);

    const data = await buildRestockData(machineConfig, date, {
      mode: requestedMode || null,
    });
    return json(data);
  } catch (error) {
    // 4xx are the restocker's to fix; anything else is ours to look at
    if (!(error instanceof RestockError) || error.status >= 500)
      console.error("restock-data error:", error);
    return errorResponse(error);
  }
}
