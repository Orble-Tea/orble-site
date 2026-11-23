export const PLAN_MACHINES = [
  { label: "30th", rows: 7, columns: 5 },
  { label: "Towne", rows: 7, columns: 5 },
];
export const DEFAULT_DRINK_SLOT_CAPACITY = 4;
export const BOBA_PACK_SLOT_CAPACITY = 6;

export function isBobaPack(value) {
  return /\bboba\s*pack\b/i.test(String(value || ""));
}

export function slotCapacityForDrink(value) {
  return isBobaPack(value)
    ? BOBA_PACK_SLOT_CAPACITY
    : DEFAULT_DRINK_SLOT_CAPACITY;
}

export class ProductionPlanValidationError extends Error {
  constructor(issues) {
    super(
      `Invalid Production Plan:\n${issues.map((issue) => issue.message).join("\n")}`,
    );
    this.name = "ProductionPlanValidationError";
    this.productionPlanInvalid = true;
    this.issues = issues;
  }
}

function headerKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function cellText(value) {
  return String(value ?? "").trim();
}

function validInteger(value) {
  return (
    (typeof value === "number" || typeof value === "string") &&
    /^\d+$/.test(cellText(value)) &&
    Number.isSafeInteger(Number(value))
  );
}

export function parseSlots(value) {
  if (value === "" || value === null || value === undefined) return [];
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = cellText(value);
  if (!text) return [];
  const tokens = text.split(/[,\s;]+/);
  return tokens.every(validInteger) ? tokens.map(Number) : null;
}

export function parseProductionPlan(values) {
  const issues = [];
  const addIssue = (code, rowNumber, message) =>
    issues.push({
      code,
      rowNumber,
      message: rowNumber ? `Row ${rowNumber}: ${message}` : message,
    });
  const [headers = [], ...rows] = values;
  const columns = new Map();
  headers.forEach((header, index) => {
    const key = headerKey(header);
    if (!key) return;
    if (columns.has(key))
      addIssue("DUPLICATE_HEADER", null, `Duplicate column "${header}".`);
    columns.set(key, index);
  });
  const column = (name) => columns.get(headerKey(name));
  const required = [
    "Drink Variation",
    "Amount to Make",
    ...PLAN_MACHINES.flatMap(({ label }) => [
      `Amount to ${label}`,
      `Slot (${label})`,
    ]),
  ];
  for (const name of required) {
    if (column(name) === undefined)
      addIssue("MISSING_HEADER", null, `Missing column "${name}".`);
  }
  if (issues.length) throw new ProductionPlanValidationError(issues);

  const plan = [];
  const usage = new Map();
  const variations = new Set();
  let currentRecipe = "";
  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const get = (name) => row[column(name)] ?? "";
    const recipe = cellText(get("Recipe"));
    const variation = cellText(get("Drink Variation"));
    if (
      ["catering", "quantity to make"].includes(recipe.toLowerCase()) ||
      variation.toLowerCase() === "recipe"
    )
      break;
    const isSummary =
      !recipe &&
      !variation &&
      validInteger(get("Amount to Make")) &&
      validInteger(get("Total Stickers")) &&
      PLAN_MACHINES.every(({ label }) =>
        [`Amount to ${label}`, `Slot (${label})`].every(
          (name) => cellText(get(name)) === "",
        ),
      );
    if (isSummary) continue;
    if (recipe) currentRecipe = recipe;
    const hasAllocation = [
      "Amount to Make",
      ...PLAN_MACHINES.flatMap(({ label }) => [
        `Amount to ${label}`,
        `Slot (${label})`,
      ]),
    ].some((name) => cellText(get(name)) !== "");
    if (!variation) {
      if (hasAllocation)
        addIssue(
          "MISSING_VARIATION",
          rowNumber,
          "Allocation has no Drink Variation.",
        );
      continue;
    }
    if (variations.has(variation.toLowerCase()))
      addIssue(
        "DUPLICATE_VARIATION",
        rowNumber,
        `Duplicate variation "${variation}".`,
      );
    variations.add(variation.toLowerCase());
    const amountToMake = get("Amount to Make");
    if (!validInteger(amountToMake))
      addIssue(
        "INVALID_QUANTITY",
        rowNumber,
        "Amount to Make must be a nonnegative integer.",
      );
    const item = {
      rowNumber,
      sourceRowNumber: rowNumber,
      recipe: currentRecipe,
      variation,
      amountToMake: Number(amountToMake),
      amountToMakeValid: true,
      topping: cellText(get("Topping")),
      machineAmounts: {},
      machineSlots: {},
      machineAmountValid: {},
      machineSlotValid: {},
      cupsToMachine: 0,
    };
    for (const machine of PLAN_MACHINES) {
      const { label, rows: machineRows, columns: machineColumns } = machine;
      const amount = get(`Amount to ${label}`);
      const slots = parseSlots(get(`Slot (${label})`));
      const slotCount = machineRows * machineColumns;
      if (!validInteger(amount))
        addIssue(
          "INVALID_QUANTITY",
          rowNumber,
          `Amount to ${label} must be a nonnegative integer.`,
        );
      if (!slots || slots.some((slot) => slot < 1 || slot > slotCount))
        addIssue(
          "INVALID_SLOTS",
          rowNumber,
          `${label} slots must be integers from 1 to ${slotCount}.`,
        );
      if (Number(amount) > 0 && !slots?.length)
        addIssue(
          "MISSING_SLOTS",
          rowNumber,
          `${label} has a positive allocation without slots.`,
        );
      if (slots) {
        const localSlots = new Set();
        for (const slot of slots) {
          const key = `${label}:${slot}`;
          if (localSlots.has(slot) || (Number(amount) > 0 && usage.has(key)))
            addIssue(
              "DUPLICATE_SLOT",
              rowNumber,
              `Duplicate ${label} slot ${slot}${usage.has(key) ? `, already assigned on row ${usage.get(key)}` : " in this row"}.`,
            );
          localSlots.add(slot);
          if (Number(amount) > 0) usage.set(key, rowNumber);
        }
        if (Number(amount) > slotCapacityForDrink(variation) * localSlots.size)
          addIssue(
            "SLOT_CAPACITY",
            rowNumber,
            `${label} allocation exceeds slot capacity for "${variation}": ${Number(amount)} assigned across ${localSlots.size} slot(s); maximum ${slotCapacityForDrink(variation) * localSlots.size}.`,
          );
      }
      item.machineAmounts[label] = Number(amount);
      item.machineSlots[label] = slots || [];
      item.machineAmountValid[label] = true;
      item.machineSlotValid[label] = true;
      item.cupsToMachine += Number(amount);
    }
    if (item.cupsToMachine > item.amountToMake)
      addIssue(
        "OVERALLOCATED",
        rowNumber,
        "Machine allocations exceed Amount to Make.",
      );
    plan.push(item);
  }
  if (!plan.length)
    addIssue("EMPTY_PLAN", null, "Production Plan has no drink rows.");
  if (issues.length) throw new ProductionPlanValidationError(issues);
  return plan;
}

export function validatedProductionPlanValues(values) {
  const plan = parseProductionPlan(values);
  const headers = values[0];
  const recipeColumn = headers.findIndex(
    (header) => headerKey(header) === "recipe",
  );
  const selected = Array.from(
    { length: plan[plan.length - 1].rowNumber },
    () => [],
  );
  selected[0] = headers;
  for (const item of plan) {
    const row = [...values[item.rowNumber - 1]];
    if (recipeColumn !== -1) row[recipeColumn] = item.recipe;
    selected[item.rowNumber - 1] = row;
  }
  return selected;
}
