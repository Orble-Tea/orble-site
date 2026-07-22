const SIZE_PATTERN = /\b(\d{1,2}\s*oz)\b/i;
const SWEETNESS_WORDS = [
  "less sweet",
  "normal",
  "half sweet",
  "extra sweet",
  "unsweet",
];

export function normalizeDrinkName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
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
  const sweetness = SWEETNESS_WORDS.find((word) =>
    drink.toLowerCase().includes(word),
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

export function isBobaPack(drink) {
  return /\bboba\s*pack\b/i.test(drink);
}

export function slotCapacityForDrink(drink) {
  return isBobaPack(drink) ? 6 : 4;
}
