import {
  getAmountHeader,
  getSlotHeader,
  MACHINE_CONFIG,
} from "../restock/config.js";
import {
  getPlanVariation,
  getRowValue,
  parseInteger,
  parseSlots,
} from "../restock/restock-service.js";

export function buildLabelPrintData(rows, options = {}) {
  const recipes = buildRecipeLabelGroups(rows, options.now || new Date());
  return {
    recipeCount: recipes.length,
    totalLabels: recipes.reduce((total, recipe) => total + recipe.labels.length, 0),
    recipes,
  };
}

function buildRecipeLabelGroups(rows, now) {
  const groups = new Map();
  let currentRecipe = "";

  for (const row of rows) {
    const recipeCell = getRowValue(row, "Recipe").trim();
    if (recipeCell) currentRecipe = recipeCell;

    const recipe = currentRecipe;
    const drinkName = getPlanVariation(row).trim();
    if (!recipe || !drinkName) continue;

    const quantity = parseInteger(getRowValue(row, "Amount to Make"));
    if (quantity <= 0) continue;

    const expirationDate = formatExpirationDate(getRowValue(row, "Date"), now);
    const directLabels = buildMachineLabels(row, expirationDate, drinkName).slice(0, quantity);
    const storageLabels = Array.from(
      { length: Math.max(0, quantity - directLabels.length) },
      () => ({ code: "", expirationDate, drinkName }),
    );
    const labels = [...directLabels, ...storageLabels];

    if (!groups.has(recipe)) {
      groups.set(recipe, { recipe, rows: [], labels: [] });
    }

    const group = groups.get(recipe);
    group.rows.push({
      id: `${recipe}::${drinkName}::${group.rows.length}`,
      recipe,
      drinkName,
      expirationDate,
      totalLabels: labels.length,
      directLabels: directLabels.length,
      storageLabels: storageLabels.length,
      labels,
    });
    group.labels.push(...labels);
  }

  return Array.from(groups.values())
    .filter((group) => group.labels.length > 0)
    .map((group) => ({
      ...group,
      totalLabels: group.labels.length,
    }));
}

function buildMachineLabels(row, expirationDate, drinkName) {
  const labels = [];
  for (const machineConfig of MACHINE_CONFIG) {
    const amount = parseInteger(getRowValue(row, getAmountHeader(machineConfig)));
    if (amount <= 0) continue;

    const slots = parseSlots(getRowValue(row, getSlotHeader(machineConfig)));
    const code = machineConfig.labelCode || machineConfig.label;
    for (let index = 0; index < amount; index += 1) {
      labels.push({
        code: `${code}#${slots.length ? slots[index % slots.length] : "00"}`,
        expirationDate,
        drinkName,
      });
    }
  }
  return labels;
}

function formatExpirationDate(value, now) {
  const date = parseProductionDate(value, now);
  date.setDate(date.getDate() + 7);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
}

function parseProductionDate(value, now) {
  const text = String(value || "").trim();
  if (!text) return todayInNewYork(now);

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

function todayInNewYork(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Number(values.year), Number(values.month) - 1, Number(values.day));
}
