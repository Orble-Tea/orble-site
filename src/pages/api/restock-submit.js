import {
  getMachineConfig,
  requireRestockSecretKey,
} from "../../lib/restock/config.js";
import {
  badRequest,
  conflict,
  invalidKey,
  json,
  parseJson,
  serverError,
  upstreamError,
} from "../../lib/restock/http.js";
import { submitRestock } from "../../lib/restock/restock-service.js";

export async function POST({ request }) {
  try {
    const payload = await parseJson(request);
    if (!requireRestockSecretKey(payload.key)) return invalidKey();

    const machineConfig = getMachineConfig(payload.machine);
    if (!machineConfig) return badRequest("Unknown machine");
    if (!machineConfig.machineId) {
      return serverError("Machine is not configured");
    }

    const result = await submitRestock(machineConfig, payload);
    return json(result);
  } catch (error) {
    if (error.alreadySubmitted) {
      const sheetId = process.env.RESTOCK_LOG_SHEET_ID;
      const existingEntryUrl =
        sheetId && error.existingEntryRow
          ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit#range=A${error.existingEntryRow}`
          : null;
      return conflict(error.message, error.existingEntryRow, existingEntryUrl);
    }
    console.error("restock-submit error:", error);
    if (error.upstream) {
      return upstreamError(error.message, error.details);
    }
    return badRequest(error.message);
  }
}
