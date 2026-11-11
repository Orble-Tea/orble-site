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
import { RestockDataQuery } from "../../lib/restock/schemas.js";

const QUERY_ERRORS = {
  machine: "Unknown machine",
  date: "Invalid date",
  mode: "Invalid mode",
};

export async function GET({ url }) {
  try {
    if (!requireRestockSecretKey(url.searchParams.get("key")))
      return invalidKey();

    const query = RestockDataQuery.safeParse({
      key: url.searchParams.get("key"),
      machine: url.searchParams.get("machine"),
      date: url.searchParams.get("date"),
      mode:
        url.searchParams.get("mode") ||
        url.searchParams.get("event") ||
        undefined,
    });
    if (!query.success) {
      const field = query.error.issues[0].path[0];
      return badRequest(QUERY_ERRORS[field] || "Invalid request");
    }

    const machineConfig = getMachineConfig(query.data.machine);
    if (!machineConfig.machineId)
      return serverError("Machine is not configured");

    const data = await buildRestockData(machineConfig, query.data.date, {
      mode: query.data.mode || null,
    });
    return json(data);
  } catch (error) {
    if (error.alreadySubmitted || error.clearoutRequiresLoad) {
      return conflict(error.message, error.existingEntryRow);
    }
    console.error("restock-data error:", error);
    if (error.upstream) {
      return upstreamError(error.message, error.details);
    }
    return serverError();
  }
}
