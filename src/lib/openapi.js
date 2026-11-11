// Builds the OpenAPI document for /docs from the Zod schemas the routes validate with.
import { createDocument } from "zod-openapi";
import {
  ErrorResponse,
  RestockData,
  RestockDataQuery,
  RestockSubmitBody,
  RestockSubmitResponse,
} from "./restock/schemas.js";

function jsonResponse(description, schema) {
  return { description, content: { "application/json": { schema } } };
}

const errors = {
  400: jsonResponse(
    "Bad request: unknown machine, bad date, or bad mode.",
    ErrorResponse,
  ),
  403: jsonResponse("Wrong or missing key.", ErrorResponse),
  409: jsonResponse(
    "This event is already logged for the batch, or Clearout was asked for before a Load.",
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
 * @param {string} serverUrl Origin the docs page should send try-it requests to.
 * @returns {object} OpenAPI 3.1 document.
 */
export function buildOpenApiDocument(serverUrl) {
  return createDocument({
    openapi: "3.1.0",
    info: {
      title: "Orble restock API",
      version: "1.0.0",
      description:
        "Prefills a restock from the Production Plan, Inventory, Restock Log and Nayax, then records what the restocker confirmed. Every route takes the shared key.",
    },
    servers: [{ url: serverUrl }],
    paths: {
      "/api/restock-data": {
        get: {
          summary: "Prefilled slot table for one machine and batch",
          description:
            "Reads the Restock Log to decide the event, Nayax for what is in each slot now, and the Production Plan (Load) or Inventory (Topoff) for what goes in.",
          requestParams: { query: RestockDataQuery },
          responses: {
            200: jsonResponse("Prefilled slots.", RestockData),
            ...errors,
          },
        },
      },
      "/api/restock-submit": {
        post: {
          summary: "Record a confirmed restock",
          description:
            "Stub in this release: validates the body and acknowledges. Nayax updates, Restock Log rows, Visits and Slack land in a follow-up.",
          requestBody: {
            content: { "application/json": { schema: RestockSubmitBody } },
          },
          responses: {
            200: jsonResponse("Accepted.", RestockSubmitResponse),
            400: errors[400],
            403: errors[403],
          },
        },
      },
    },
  });
}
