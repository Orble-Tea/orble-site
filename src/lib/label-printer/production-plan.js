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

const SPARE_LABEL_COUNT = 1;

export function buildLabelPrintData(rows, options = {}) {
  const recipes = buildRecipeLabelGroups(rows, options.now || new Date());
  return {
    recipeCount: recipes.length,
    totalLabels: recipes.reduce((total, recipe) => total + recipe.labels.length, 0),
    recipes,
  };
}

/**
 * Groups table rows by recipe so each recipe can be sent as one cut job while
 * preserving the individual drink rows the operator selects in the UI. Each
 * cut job prints a "recipe label group" that includes all variations of the
 * same base recipe.
 */
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

    const expirationDate = formatExpirationDate(now);
    const directLabels = buildMachineLabels(row, expirationDate, drinkName).slice(0, quantity);
    const storageLabels = Array.from(
      { length: Math.max(0, quantity - directLabels.length) },
      () => ({ code: "", expirationDate, drinkName }),
    );
    const spareLabels = Array.from(
      { length: SPARE_LABEL_COUNT },
      () => ({ code: "", expirationDate, drinkName }),
    );
    const labels = [...directLabels, ...storageLabels, ...spareLabels];

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
      spareLabels: spareLabels.length,
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
    const slotCode = slots.length ? slots.join(",") : "00";
    for (let index = 0; index < amount; index += 1) {
      labels.push({
        code: `${code}#${slotCode}`,
        expirationDate,
        drinkName,
      });
    }
  }
  return labels;
}

function formatExpirationDate(now) {
  const date = todayUtc(now);
  date.setUTCDate(date.getUTCDate() + 7);
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
  });
}

function todayUtc(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
}
