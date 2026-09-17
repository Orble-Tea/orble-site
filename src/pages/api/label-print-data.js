import { requireRestockSecretKey } from "../../lib/restock/config.js";
import {
  invalidKey,
  json,
  serverError,
  upstreamError,
} from "../../lib/restock/http.js";
import { loadProductionPlanRows } from "../../lib/restock/restock-service.js";
import { buildLabelPrintData } from "../../lib/label-printer/production-plan.js";

export async function GET({ url }) {
  try {
    if (!requireRestockSecretKey(url.searchParams.get("key"))) return invalidKey();

    const rows = await loadProductionPlanRows();
    return json(buildLabelPrintData(rows));
  } catch (error) {
    console.error("label-print-data error:", error);
    if (error.upstream) {
      return upstreamError(error.message, error.details);
    }
    return serverError(error.message || "Unable to build label print data");
  }
}
