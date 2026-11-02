import { requireRestockSecretKey } from "../../lib/restock/config.js";
import { ERRORS, RestockError } from "../../lib/restock/errors.js";
import { errorResponse, json } from "../../lib/restock/http.js";
import { buildOpenApiDocument } from "../../lib/openapi.js";

export async function GET({ url }) {
  if (!requireRestockSecretKey(url.searchParams.get("key")))
    return errorResponse(new RestockError(ERRORS.invalidKey));
  return json(buildOpenApiDocument(url.origin));
}
