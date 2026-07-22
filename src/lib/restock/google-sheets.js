import { createSign } from "node:crypto";

import { assertConfigured } from "./config.js";

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
  return assertConfigured(
    process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    "GOOGLE_PRIVATE_KEY",
  );
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
    throw new Error(`Google auth failed: ${await response.text()}`);
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

async function sheetsFetch(path, options = {}) {
  const token = await getAccessToken();
  const response = await fetch(`${SHEETS_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Google Sheets request failed: ${await response.text()}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function readSheetValues(spreadsheetId, sheetName) {
  const range = encodeURIComponent(`${quoteSheetName(sheetName)}`);
  const payload = await sheetsFetch(`/${spreadsheetId}/values/${range}`);
  return payload.values || [];
}

export async function appendSheetRows(spreadsheetId, sheetName, rows) {
  if (!rows.length) return null;
  const range = encodeURIComponent(`${quoteSheetName(sheetName)}!A:Z`);
  return sheetsFetch(
    `/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      body: JSON.stringify({ values: rows }),
    },
  );
}

export async function updateSheetValues(spreadsheetId, sheetName, rangeA1, rows) {
  const range = encodeURIComponent(`${quoteSheetName(sheetName)}!${rangeA1}`);
  return sheetsFetch(`/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: rows }),
  });
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

export function getHeaderIndex(headers, header) {
  return headers.findIndex(
    (candidate) => String(candidate).trim().toLowerCase() === header.toLowerCase(),
  );
}

export function columnToLetter(columnNumber) {
  let remaining = columnNumber;
  let letters = "";
  while (remaining > 0) {
    const remainder = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    remaining = Math.floor((remaining - remainder - 1) / 26);
  }
  return letters;
}
