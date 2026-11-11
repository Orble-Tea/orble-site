import { requireRestockSecretKey } from "../../lib/restock/config.js";
import { invalidKey, json } from "../../lib/restock/http.js";
import { buildOpenApiDocument } from "../../lib/openapi.js";

export async function GET({ url }) {
  if (!requireRestockSecretKey(url.searchParams.get("key")))
    return invalidKey();
  return json(buildOpenApiDocument(url.origin));
}
