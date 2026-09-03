import { createPrivateKey, createSign } from "node:crypto";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_BASE_URL = "https://sheets.googleapis.com/v4/spreadsheets";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

let cachedToken;

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getPrivateKey() {
  const raw = requireEnv("GOOGLE_PRIVATE_KEY").trim();
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

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) {
    return cachedToken.token;
  }

  const email = requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
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
    throw new Error(`Google auth failed with status ${response.status}`);
  }

  const payload = await response.json();
  cachedToken = {
    token: payload.access_token,
    expiresAt: now + Number(payload.expires_in || 3600),
  };
  return cachedToken.token;
}

function quoteSheetName(sheetName) {
  return `'${String(sheetName).replace(/'/g, "''")}'`;
}

async function sheetsRequest(spreadsheetId, path, options = {}) {
  const token = await getAccessToken();
  const response = await fetch(`${SHEETS_BASE_URL}/${spreadsheetId}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `Google Sheets request failed with status ${response.status}${details ? `: ${details}` : ""}`,
    );
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function readSpreadsheetMetadata(spreadsheetId) {
  return sheetsRequest(spreadsheetId, "");
}

export async function ensureSheet(spreadsheetId, sheetName) {
  const metadata = await readSpreadsheetMetadata(spreadsheetId);
  const sheets = Array.isArray(metadata?.sheets) ? metadata.sheets : [];
  if (sheets.some((sheet) => sheet.properties?.title === sheetName)) {
    return;
  }

  await sheetsRequest(spreadsheetId, ":batchUpdate", {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          addSheet: {
            properties: {
              title: sheetName,
            },
          },
        },
      ],
    }),
  });
}

export async function getLatestSheetTitle(spreadsheetId) {
  const metadata = await readSpreadsheetMetadata(spreadsheetId);
  const sheets = Array.isArray(metadata?.sheets) ? metadata.sheets : [];
  const latestSheet =
    findLatestDateSheetTitle(sheets) || sheets.at(-1)?.properties?.title;
  if (!latestSheet) {
    throw new Error(`Spreadsheet ${spreadsheetId} has no sheets`);
  }
  return latestSheet;
}

function findLatestDateSheetTitle(sheets) {
  return sheets
    .map((sheet) => {
      const title = sheet?.properties?.title;
      return {
        title,
        time: parseSheetDate(title)?.getTime() ?? Number.NEGATIVE_INFINITY,
      };
    })
    .filter((sheet) => sheet.title && Number.isFinite(sheet.time))
    .sort((left, right) => right.time - left.time)[0]?.title;
}

function parseSheetDate(title) {
  const text = String(title || "").trim();
  const isoMatch = text.match(
    /(?:^|[^\d])(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[^\d])/,
  );
  if (isoMatch) {
    return new Date(
      Date.UTC(
        Number(isoMatch[1]),
        Number(isoMatch[2]) - 1,
        Number(isoMatch[3]),
      ),
    );
  }

  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    return new Date(
      Date.UTC(
        Number(slashMatch[3]),
        Number(slashMatch[1]) - 1,
        Number(slashMatch[2]),
      ),
    );
  }

  return null;
}

export async function clearLatestSheet(spreadsheetId) {
  const latestSheetTitle = await getLatestSheetTitle(spreadsheetId);
  await clearSheetRange(spreadsheetId, latestSheetTitle);
  return latestSheetTitle;
}

export async function clearSheetRange(
  spreadsheetId,
  sheetName,
  range = "A1:ZZ1000",
) {
  return sheetsRequest(
    spreadsheetId,
    `/values/${encodeURIComponent(`${quoteSheetName(sheetName)}!${range}`)}:clear`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export async function writeSheetValues(
  spreadsheetId,
  sheetName,
  values,
  startCell = "A1",
) {
  return sheetsRequest(
    spreadsheetId,
    `/values/${encodeURIComponent(`${quoteSheetName(sheetName)}!${startCell}`)}?valueInputOption=RAW`,
    {
      method: "PUT",
      body: JSON.stringify({
        majorDimension: "ROWS",
        values,
      }),
    },
  );
}

export async function readSheetValues(
  spreadsheetId,
  sheetName,
  range = "A1:ZZ1000",
) {
  const payload = await sheetsRequest(
    spreadsheetId,
    `/values/${encodeURIComponent(`${quoteSheetName(sheetName)}!${range}`)}`,
  );
  return payload.values || [];
}

export async function seedSheet(spreadsheetId, sheetName, values) {
  await ensureSheet(spreadsheetId, sheetName);
  await clearSheetRange(spreadsheetId, sheetName);
  if (values.length > 0) {
    await writeSheetValues(spreadsheetId, sheetName, values);
  }
}

export async function seedLatestSheet(spreadsheetId, values) {
  const latestSheetTitle = await getLatestSheetTitle(spreadsheetId);
  await seedSheet(spreadsheetId, latestSheetTitle, values);
  return latestSheetTitle;
}
