import {
  assertConfigured,
  PRODUCTION_PLAN_SHEET,
  requireRestockSecretKey,
  SHEET_IDS,
} from "../../lib/restock/config.js";
import {
  invalidKey,
  json,
  serverError,
  upstreamError,
} from "../../lib/restock/http.js";
import { readSheetValues, rowsToObjects } from "../../lib/restock/google-sheets.js";

const AMOUNT_ALIASES = ["Total Stickers", "Amount to Make", "Make", "Quantity", "Qty"];
const DIRECT_ALIASES = ["Amount to Take to Machine", "Take to Machine", "To Machine"];
const DATE_ALIASES = ["Date", "Production Date", "Print Date", "Batch Date"];
const DRINK_ALIASES = ["Drink Variation", "Drink", "Variation", "Drink Name"];
const RECIPE_ALIASES = ["Recipe", "Recipe Name", "Base Recipe"];
const SLOT_30TH_ALIASES = ["Slot (30TH)", "Slot 30TH", "30TH Slot"];
const SLOT_TOWNE_ALIASES = ["Slot (Towne)", "Slot Towne", "Towne Slot"];

export async function GET({ url }) {
  try {
    if (!requireRestockSecretKey(url.searchParams.get("key"))) return invalidKey();

    const values = await readSheetValues(
      assertConfigured(SHEET_IDS.productionPlan, "PRODUCTION_PLAN_SHEET_ID"),
      PRODUCTION_PLAN_SHEET,
    );
    const rows = rowsToObjects(values);
    const recipes = buildRecipeLabelGroups(rows);
    return json({
      recipeCount: recipes.length,
      totalLabels: recipes.reduce((total, recipe) => total + recipe.labels.length, 0),
      recipes,
    });
  } catch (error) {
    console.error("label-print-data error:", error);
    if (error.upstream) {
      return upstreamError(error.message, error.details);
    }
    return serverError(error.message || "Unable to build label print data");
  }
}

function buildRecipeLabelGroups(rows) {
  const groups = new Map();
  let currentRecipe = "";

  for (const row of rows) {
    const recipeCell = getFirstValue(row, RECIPE_ALIASES).trim();
    if (recipeCell) currentRecipe = recipeCell;
    const recipe = currentRecipe;
    const drinkName = getFirstValue(row, DRINK_ALIASES).trim();
    if (!recipe || !drinkName) continue;

    const quantity = parseQuantity(getFirstValue(row, AMOUNT_ALIASES));
    if (quantity <= 0) continue;

    const directCount = parseQuantity(getFirstValue(row, DIRECT_ALIASES));
    const expirationDate = formatExpirationDate(getFirstValue(row, DATE_ALIASES));
    const slots = machineSlots(row);

    if (!groups.has(recipe)) {
      groups.set(recipe, { recipe, labels: [] });
    }

    const group = groups.get(recipe);
    for (let index = 0; index < quantity; index += 1) {
      const direct = index < directCount;
      const slot = slots[index % slots.length];
      group.labels.push({
        code: direct ? `D${slot.machine}#${slot.slot}` : "",
        expirationDate,
        drinkName,
      });
    }
  }

  return Array.from(groups.values()).filter((group) => group.labels.length > 0);
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function getFirstValue(row, aliases) {
  const columnNames = Object.keys(row);
  for (const alias of aliases) {
    const expected = normalizeHeader(alias);
    const columnName = columnNames.find(
      (candidate) => normalizeHeader(candidate) === expected,
    );
    if (columnName && String(row[columnName] ?? "").trim()) {
      return String(row[columnName] ?? "");
    }
  }
  return "";
}

function parseQuantity(value) {
  const number = Number(String(value || "").trim());
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.ceil(number));
}

function formatExpirationDate(value) {
  const date = parseDate(value);
  date.setDate(date.getDate() + 7);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
}

function parseDate(value) {
  const text = String(value || "").trim();
  if (!text) return new Date();

  const slashMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (slashMatch) {
    const year = Number(slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3]);
    return new Date(year, Number(slashMatch[1]) - 1, Number(slashMatch[2]));
  }

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  throw new Error(`Could not parse production date: ${text}`);
}

function machineSlots(row) {
  const slots = [];
  for (const slot of parseSlots(getFirstValue(row, SLOT_30TH_ALIASES))) {
    slots.push({ machine: "30TH", slot });
  }
  for (const slot of parseSlots(getFirstValue(row, SLOT_TOWNE_ALIASES))) {
    slots.push({ machine: "TWNE", slot });
  }
  return slots.length ? slots : [{ machine: "30TH", slot: "00" }];
}

function parseSlots(value) {
  return String(value || "").match(/\d+/g) || [];
}
