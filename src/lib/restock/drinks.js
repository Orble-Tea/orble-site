export const DEFAULT_DRINK_SLOT_CAPACITY = 4;
export const BOBA_PACK_SLOT_CAPACITY = 6;

const SIZE_PATTERN = /\b(\d{1,2}\s*oz)\b/i;
const SWEETNESS_LEVELS = ["less sugar", "less sweet", "normal", "regular"];
const NAYAX_FLAVOR_CODES = {
  APPL: "Apple",
  BLAC: "Black Tea",
  BROW: "Brown Sugar Milk Tea",
  CELE: "Celestial Jasmine",
  HORC: "Horchata",
  MANG: "Mango Passion Fruit Tea",
  MATC: "Matcha",
  STRA: "Strawberry Matcha",
  TARO: "Taro Tea",
  THAI: "Thai Tea",
  VIET: "Viet Latte",
};

const NAYAX_TOPPING_CODES = {
  LYC: "Lychee",
};

const NAYAX_SWEETNESS_CODES = {
  LESS: "Less Sugar",
  REG: null,
};

export function normalizeDrinkName(value) {
  const nayaxName = expandNayaxDrinkCode(value);
  if (nayaxName) return nayaxName;

  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function expandNayaxDrinkCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!/^[A-Z]+_\d{1,2}(?:_[A-Z]+)*$/.test(code)) return null;

  const [flavorCode, sizeCode, ...modifiers] = code.split("_");
  const flavor = NAYAX_FLAVOR_CODES[flavorCode];
  if (!flavor) return null;

  const size = `${Number(sizeCode)}oz`;
  const sweetness = modifiers
    .map((modifier) => NAYAX_SWEETNESS_CODES[modifier])
    .find(Boolean);
  const topping = modifiers
    .map((modifier) => NAYAX_TOPPING_CODES[modifier])
    .find(Boolean);

  return [flavor, size, sweetness, topping ? `w/ ${topping}` : ""]
    .filter(Boolean)
    .join(" ");
}

export function parseDrinkName(value) {
  const drink = normalizeDrinkName(value);
  if (!drink) {
    return { flavor: null, size: null, topping: null, sweetness: null };
  }

  const sizeMatch = drink.match(SIZE_PATTERN);
  const size = sizeMatch ? sizeMatch[1].replace(/\s+/g, "") : null;
  const toppingMatch = drink.match(
    /\b(?:w\/|with)\s+(.+?)(?:\s+\d{1,2}\s*oz\b|$)/i,
  );
  const sweetness = SWEETNESS_LEVELS.find((level) =>
    drink.toLowerCase().includes(level),
  );

  let flavor = drink;
  if (sizeMatch) flavor = flavor.replace(sizeMatch[0], "");
  if (toppingMatch) flavor = flavor.replace(/\b(?:w\/|with)\s+.+$/i, "");
  if (sweetness) flavor = flavor.replace(new RegExp(sweetness, "i"), "");
  flavor = normalizeDrinkName(flavor.replace(/\bw\/\b/i, ""));

  return {
    flavor: flavor || drink,
    size,
    topping: toppingMatch ? normalizeDrinkName(toppingMatch[1]) : null,
    sweetness: sweetness
      ? sweetness.replace(/\b\w/g, (letter) => letter.toUpperCase())
      : null,
  };
}

export function canonicalDrinkKey(value) {
  const parsed = parseDrinkName(value);
  const sweetness = parsed.sweetness
    ?.replace(/Less Sweet/i, "Less Sugar")
    .replace(/Regular|Normal/i, "");
  return [
    parsed.flavor,
    parsed.size,
    sweetness || null,
    parsed.topping,
  ]
    .filter(Boolean)
    .map((part) => part.toLowerCase())
    .join("|");
}

export function isBobaPack(drink) {
  return /\bboba\s*pack\b/i.test(drink);
}

export function slotCapacityForDrink(drink) {
  return isBobaPack(drink) ? BOBA_PACK_SLOT_CAPACITY : DEFAULT_DRINK_SLOT_CAPACITY;
}
