import { createPrivateKey, createSign } from "node:crypto";

import { assertConfigured } from "./config.js";
import { UpstreamServiceError } from "./errors.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_BASE_URL = "https://sheets.googleapis.com/v4/spreadsheets";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

let tokenCache;

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function getPrivateKey() {
  const raw = assertConfigured(
    process.env.GOOGLE_PRIVATE_KEY,
    "GOOGLE_PRIVATE_KEY",
  ).trim();
  const keyMaterial = raw.startsWith("{") ? JSON.parse(raw).private_key : raw;
  const pem = String(keyMaterial || "")
    .replace(/^"(.*)"$/s, "$1")
    .replace(/\\n/g, "\n")
    .trim();

  if (!pem.includes("BEGIN PRIVATE KEY")) {
    throw new Error(
      "GOOGLE_PRIVATE_KEY must be a PEM private key with BEGIN/END lines, or a service account JSON string containing private_key",
    );
  }

  try {
    createPrivateKey(pem);
  } catch (error) {
    throw new Error(`Invalid GOOGLE_PRIVATE_KEY format: ${error.message}`);
  }

  return pem;
}

function googleAuthMode() {
  return process.env.GOOGLE_SHEETS_ACCESS_TOKEN
    ? "access_token"
    : "service_account";
}

async function getAccessToken() {
  if (process.env.GOOGLE_SHEETS_ACCESS_TOKEN) {
    return process.env.GOOGLE_SHEETS_ACCESS_TOKEN;
  }

  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt > now + 60) {
    return tokenCache.token;
  }

  const email = assertConfigured(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  );
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(
    JSON.stringify({
      iss: email,
      scope: SHEETS_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      exp: now + 3600,
      iat: now,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = signer
    .sign(getPrivateKey(), "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });

  if (!response.ok) {
    throw new UpstreamServiceError("Google Sheets authentication failed", {
      service: "google_sheets",
      operation: "authenticate_service_account",
      status: response.status,
      authMode: "service_account",
    });
  }

  const payload = await response.json();
  tokenCache = {
    token: payload.access_token,
    expiresAt: now + Number(payload.expires_in || 3600),
  };
  return tokenCache.token;
}

function quoteSheetName(sheetName) {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

export async function readSpreadsheetMetadata(spreadsheetId) {
  return sheetsFetch(`/${spreadsheetId}`, {
    context: {
      operation: "reading spreadsheet metadata",
      sheetName: null,
    },
  });
}

export async function readLatestSheetValues(spreadsheetId) {
  const latestSheet = await getLatestSheetName(spreadsheetId);
  return readSheetValues(spreadsheetId, latestSheet);
}

export async function getLatestSheetName(spreadsheetId) {
  const metadata = await readSpreadsheetMetadata(spreadsheetId);
  const sheets = Array.isArray(metadata?.sheets) ? metadata.sheets : [];
  const latestSheet = sheets.at(-1)?.properties?.title;

  if (!latestSheet) {
    throw new UpstreamServiceError("Google Sheets workbook has no sheets", {
      service: "google_sheets",
      operation: "read_latest_sheet",
      spreadsheetId,
      status: 404,
      authMode: googleAuthMode(),
    });
  }

  return latestSheet;
}

async function sheetsFetch(path, options = {}) {
  const token = await getAccessToken();
  const { context, ...fetchOptions } = options;
  const response = await fetch(`${SHEETS_BASE_URL}${path}`, {
    ...fetchOptions,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(fetchOptions.headers || {}),
    },
  });

  if (!response.ok) {
    throw new UpstreamServiceError(
      `Google Sheets request failed while ${context?.operation || "reading sheet"}`,
      {
        service: "google_sheets",
        operation: context?.operation || "read_sheet",
        sheetName: context?.sheetName,
        status: response.status,
        authMode: googleAuthMode(),
      },
    );
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function readSheetValues(spreadsheetId, sheetName) {
  const range = encodeURIComponent(`${quoteSheetName(sheetName)}`);
  const payload = await sheetsFetch(`/${spreadsheetId}/values/${range}`, {
    context: {
      operation: `reading ${sheetName}`,
      sheetName,
    },
  });
  return payload.values || [];
}

export async function appendSheetValues(spreadsheetId, sheetName, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const range = encodeURIComponent(`${quoteSheetName(sheetName)}`);
  return sheetsFetch(
    `/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`,
    {
      method: "POST",
      body: JSON.stringify({ values: rows }),
      context: {
        operation: `appending ${sheetName}`,
        sheetName,
      },
    },
  );
}

export async function updateSheetValues(
  spreadsheetId,
  sheetName,
  rangeA1,
  rows,
) {
  const range = encodeURIComponent(`${quoteSheetName(sheetName)}!${rangeA1}`);
  return sheetsFetch(
    `/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ values: rows }),
      context: {
        operation: `updating ${sheetName}`,
        sheetName,
      },
    },
  );
}

export function rowsToObjects(values) {
  const [headers = [], ...rows] = values;
  return rows.map((row, index) => {
    const object = { _rowNumber: index + 2 };
    headers.forEach((header, columnIndex) => {
      object[String(header).trim()] = row[columnIndex] ?? "";
    });
    return object;
  });
}
