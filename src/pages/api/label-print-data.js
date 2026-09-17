import { requireRestockSecretKey } from "../../lib/restock/config.js";
import { invalidKey, json, serverError } from "../../lib/restock/http.js";
import { loadProductionPlanRows } from "../../lib/restock/restock-service.js";
import { buildLabelPrintData } from "../../lib/label-printer/production-plan.js";

/**
 * Reads the authorized production plan without exposing upstream error details.
 * @param {{url: URL}} context Astro request context.
 * @returns {Promise<Response>} Drink labels or a generic public error.
 */
export async function GET({ url }) {
  try {
    if (!requireRestockSecretKey(url.searchParams.get("key")))
      return invalidKey();

    const rows = await loadProductionPlanRows();
    return json(buildLabelPrintData(rows));
  } catch (error) {
    console.error("label-print-data error:", error);
    return serverError();
  }
}
