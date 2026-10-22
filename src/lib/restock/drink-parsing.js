export const DEFAULT_DRINK_SLOT_CAPACITY = 4;
export const BOBA_PACK_SLOT_CAPACITY = 6;
export const EMPTY_SLOT_MIN_FILL = DEFAULT_DRINK_SLOT_CAPACITY / 2;

const SIZE_PATTERN = /\b(\d{1,2}\s*oz)\b/i;
export const KNOWN_SIZES = ["12oz", "16oz", "22oz"];
export const LESS_SWEET = "Less Sweet";
export const REGULAR_SWEETNESS = "Regular Sweetness";
// The default sweetness; the model stores it as null
const REGULAR_SWEETNESS_PATTERN = /\bregular\s+sweetness\b/i;
const LESS_SWEET_PATTERN = /\bless\s+sweet\b/i;
const NAYAX_FLAVOR_CODES = {
  APPL: "Apple Crisp Latte",
  BLAC: "Black Tea",
  BROW: "Brown Sugar Milk Tea",
  COLD: "Cold Brew",
  HORC: "Horchata",
  JASM: "Celestial Jasmine",
  MANG: "Mango Passion Fruit Tea",
  MATC: "Matcha",
  MOCHA: "Mocha Latte",
  SMAT: "Strawberry Matcha",
  TARO: "Taro Tea",
  THAI: "Thai Tea",
  VIET: "Viet Latte",
};

const NAYAX_TOPPING_CODES = {
  ALO: "Aloe",
  LYC: "Lychee",
};

const NAYAX_SWEETNESS_CODES = {
  LESS: LESS_SWEET,
  REG: REGULAR_SWEETNESS,
};

// Longest first so "Strawberry Matcha" is taken before "Matcha"
export const KNOWN_FLAVORS = Object.values(NAYAX_FLAVOR_CODES).sort(
  (left, right) => right.length - left.length,
);
// "Strawberry Matcha" is Matcha with a strawberry topping, so the catalog name
// stays readable when the topping is written first
export const KNOWN_TOPPINGS = [...Object.values(NAYAX_TOPPING_CODES), "Strawberry"];
const TOPPING_MARKER_PATTERN = /\b(?:w\/|with)(?=\s|$)/i;

export function normalizeDrinkName(value) {
  const nayaxName = expandNayaxDrinkCode(value);
  if (nayaxName) return nayaxName;

  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Drink parts to the catalog name, e.g. "Thai Tea 16oz Less Sweet w/ Lychee". */
export function formatDrinkName(parts) {
  if (!parts?.flavor) return "";
  return [
    parts.flavor,
    parts.size,
    // Only sized drinks carry a sweetness; boba packs don't
    parts.size ? parts.sweetness || REGULAR_SWEETNESS : null,
    parts.topping ? `w/ ${parts.topping}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function expandNayaxDrinkCode(value) {
  const code = String(value || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]+_\d{1,2}(?:_[A-Z]+)*$/.test(code)) return null;

  const [flavorCode, sizeCode, ...modifiers] = code.split("_");
  const flavor = NAYAX_FLAVOR_CODES[flavorCode];
  if (!flavor) return null;

  // A modifier with no meaning is kept as typed, so parseDrinkName reports it
  const unknownModifiers = modifiers.filter(
    (modifier) =>
      !NAYAX_SWEETNESS_CODES[modifier] && !NAYAX_TOPPING_CODES[modifier],
  );
  return [
    formatDrinkName({
      flavor,
      size: `${Number(sizeCode)}oz`,
      sweetness: modifiers
        .map((modifier) => NAYAX_SWEETNESS_CODES[modifier])
        .find(Boolean),
      topping: modifiers
        .map((modifier) => NAYAX_TOPPING_CODES[modifier])
        .find(Boolean),
    }),
    ...unknownModifiers,
  ].join(" ");
}

const wordPattern = (word) => new RegExp(`\\b${word}\\b`, "i");

/**
 * A drink name as its parts, from any source (Nayax code or sheet text). Each
 * known part is taken wherever it sits in the name; the words left over are
 * `unknown`. A name is a drink a slot can hold only when it has a flavor and
 * a size and nothing unknown (see isValidDrink).
 */
export function parseDrinkName(value) {
  let rest = normalizeDrinkName(value);
  if (!rest) {
    return {
      flavor: null,
      size: null,
      topping: null,
      sweetness: null,
      unknown: null,
    };
  }

  const take = (pattern) => {
    const match = rest.match(pattern);
    if (!match) return null;
    rest = rest.replace(match[0], " ");
    return match;
  };

  const sizeText = take(SIZE_PATTERN)?.[1].replace(/\s+/g, "").toLowerCase();
  const size = sizeText && KNOWN_SIZES.includes(sizeText) ? sizeText : null;
  const sweetness = take(LESS_SWEET_PATTERN) ? LESS_SWEET : null;
  take(REGULAR_SWEETNESS_PATTERN);
  take(TOPPING_MARKER_PATTERN);
  const topping =
    KNOWN_TOPPINGS.find((candidate) => take(wordPattern(candidate))) ?? null;
  const flavor =
    KNOWN_FLAVORS.find((candidate) => take(wordPattern(candidate))) ?? null;
  const unknown =
    normalizeDrinkName([sizeText && !size ? sizeText : "", rest].join(" ")) ||
    null;

  return { flavor, size, topping, sweetness, unknown };
}

/** Whether parsed parts name a drink a slot can hold. */
export function isValidDrink(parsed) {
  return Boolean(parsed.flavor && parsed.size && !parsed.unknown);
}

/** Why parsed parts are not a valid drink, e.g. `unrecognized "Less Sugar", missing or invalid size`. */
export function describeInvalidDrink(parsed) {
  return [
    parsed.unknown && `unrecognized "${parsed.unknown}"`,
    !parsed.flavor && "missing flavor",
    !parsed.size && "missing or invalid size",
  ]
    .filter(Boolean)
    .join(", ");
}

/** The canonical key of a drink name, or "" when it is not a valid drink. */
export function canonicalDrinkKey(value) {
  const parsed = parseDrinkName(value);
  return isValidDrink(parsed) ? canonicalDrinkKeyFromParts(parsed) : "";
}

export function canonicalDrinkKeyFromParts(parsed) {
  return canonicalDrinkKeyFromValues({
    flavor: parsed.flavor,
    size: parsed.size,
    sweetness: parsed.sweetness,
    topping: parsed.topping,
  });
}

export function canonicalDrinkKeyFromSlot(slot) {
  return canonicalDrinkKeyFromValues({
    flavor: slot.flavor,
    size: slot.size,
    sweetness: slot.sweetness,
    topping: slot.topping,
  });
}

/** Whether drink parts and a drink name are the same drink. */
export function sameDrink(parts, drinkName) {
  return canonicalDrinkKeyFromParts(parts) === canonicalDrinkKey(drinkName);
}

function canonicalDrinkKeyFromValues({ flavor, size, sweetness, topping }) {
  if (!flavor || !size) return "";
  return [flavor, size, sweetness, topping]
    .filter(Boolean)
    .map((part) => part.toLowerCase())
    .join("|");
}

export function isBobaPack(drink) {
  return /\bboba\s*pack\b/i.test(drink);
}

export function slotCapacityForDrink(drink) {
  return isBobaPack(drink)
    ? BOBA_PACK_SLOT_CAPACITY
    : DEFAULT_DRINK_SLOT_CAPACITY;
}

export function slotCapacityForDrinkParts(parts) {
  const searchableText = [
    parts.flavor,
    parts.size,
    parts.sweetness,
    parts.topping,
  ]
    .filter(Boolean)
    .join(" ");
  return isBobaPack(searchableText)
    ? BOBA_PACK_SLOT_CAPACITY
    : DEFAULT_DRINK_SLOT_CAPACITY;
}
