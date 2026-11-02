// Builds the OpenAPI document for /docs from the Zod schemas /api/restock validates with.
import { createDocument } from "zod-openapi";
import {
  ErrorResponse,
  RestockForm,
  RestockQuery,
  RestockSubmit,
  SubmitResponse,
} from "./restock/schemas.js";

function jsonResponse(description, schema) {
  return { description, content: { "application/json": { schema } } };
}

const errors = {
  400: jsonResponse(
    "Bad request: unknown machine, bad date, bad isClearout, or a body that fails validation. The error text names the problem.",
    ErrorResponse,
  ),
  403: jsonResponse("Wrong or missing key.", ErrorResponse),
  409: jsonResponse(
    "The batch already has this event logged, or the batch order rules refuse it. details carries the existing Restock Log row when there is one.",
    ErrorResponse,
  ),
  500: jsonResponse(
    "Machine not configured, or an unexpected server error.",
    ErrorResponse,
  ),
  502: jsonResponse(
    "Nayax or Google Sheets failed. Retry later.",
    ErrorResponse,
  ),
};

/**
 * @param {string} serverUrl Origin the docs page sends try-it requests to.
 * @returns {object} OpenAPI 3.1 document.
 */
export function buildOpenApiDocument(serverUrl) {
  return createDocument({
    openapi: "3.1.0",
    info: {
      title: "Orble Beta API",
      version: "1.0.0",
      description:
        "Enables the restocking flow end-to-end, from determining which expiration labels need to be printed for a batch, to letting a restocker know what drinks go to which vending machine location, to showing which drinks go to which slots when stocking the machine.",
    },
    servers: [{ url: serverUrl }],
    tags: [{ name: "Restock" }],
    paths: {
      "/api/restock": {
        get: {
          tags: ["Restock"],
          summary: "Fetches all data needed to prefill the restock form",
          description: [
            "Reads the Restock Log to decide whether the user is loading the machine, splitting drinks from refrigerated storage between machines in the kitchen, or topping off the machine.",
            "Reads Nayax for what is in each slot now.",
            "Reads either the Production Plan (on Load) or Inventory (on Split and Topoff) for what goes in.",
          ].join("\n\n"),
          requestParams: { query: RestockQuery },
          responses: {
            200: jsonResponse(
              "The form. A MachineForm for Load, Topoff and Clearout; a SplitForm when the kitchen split is next.",
              RestockForm,
            ),
            ...errors,
          },
        },
        post: {
          tags: ["Restock"],
          summary: "Processes the restock event",
          description: [
            "Updates Nayax and logs to Sheets.",
            "Split: writes each drink's split to the date's Inventory tab and logs one Split row. Sheets only.",
            "Load, Topoff, Clearout: logs the rows as Nayax pending, updates Nayax, then marks them Complete. Sending the same form again finishes from where the last press stopped.",
          ].join("\n\n"),
          requestBody: {
            content: { "application/json": { schema: RestockSubmit } },
          },
          responses: {
            200: jsonResponse("Recorded.", SubmitResponse),
            ...errors,
          },
        },
      },
    },
  });
}
