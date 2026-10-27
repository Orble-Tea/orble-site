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

/**
 * Builds selectable drink rows directly from the sheet, including one backup
 * label per drink. Machine labels retain every assigned slot; storage is blank.
 * @param {Object[]} rows Production Plan rows keyed by column header.
 * @param {{now?: Date}} options Clock override for deterministic expiration dates.
 * @returns {{rows: Object[]}} Drink rows in sheet order, each with its labels.
 */
export function buildLabelPrintData(rows, options = {}) {
  const printRows = [];
  const expirationDate = formatExpirationDate(options.now || new Date());

  for (const row of rows) {
    const drinkName = getPlanVariation(row).trim();
    if (!drinkName) continue;

    const quantity = parseInteger(getRowValue(row, "Amount to Make"));
    if (quantity <= 0) continue;

    const directLabels = buildMachineLabels(
      row,
      expirationDate,
      drinkName,
    ).slice(0, quantity);
    const storageLabels = Array.from(
      { length: Math.max(0, quantity - directLabels.length) },
      () => ({ code: "", expirationDate, drinkName }),
    );
    const spareLabels = Array.from({ length: SPARE_LABEL_COUNT }, () => ({
      code: "",
      expirationDate,
      drinkName,
    }));
    const labels = [...directLabels, ...storageLabels, ...spareLabels];

    printRows.push({
      drinkName,
      directLabels: directLabels.length,
      storageLabels: storageLabels.length,
      spareLabels: spareLabels.length,
      labels,
    });
  }

  return { rows: printRows };
}

/**
 * Repeats each machine's full slot list on all labels allocated to that machine.
 * @param {Object} row Sheet row containing machine quantities and slots.
 * @param {string} expirationDate Formatted expiration date.
 * @param {string} drinkName Full drink variation name.
 * @returns {Object[]} Machine labels in configured machine order.
 */
function buildMachineLabels(row, expirationDate, drinkName) {
  const labels = [];
  for (const machineConfig of MACHINE_CONFIG) {
    const amount = parseInteger(
      getRowValue(row, getAmountHeader(machineConfig)),
    );
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

/**
 * Formats seven calendar days after the supplied instant in UTC.
 * @param {Date} now Production date; never mutated.
 * @returns {string} Expiration in MM/DD/YY format.
 */
function formatExpirationDate(now) {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + 7);
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
  });
}
