const PRINT_QUEUE_SHEET = 'Print Queue';
const QUEUE_HEADERS = [
  'Job ID',
  'Created At',
  'Recipe',
  'Label Number',
  'Recipe Label Count',
  'Code',
  'Expiration Date',
  'Drink Name',
  'Status',
];

function runEverythingLabels() {
  const result = buildPrintQueue_();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `Queued ${result.totalLabels} labels across ${result.recipeCount} recipes.`,
    'Orble labels',
    8
  );
}

function dryRunEverythingLabels() {
  const result = buildPrintQueue_(true);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `Dry run: ${result.totalLabels} labels across ${result.recipeCount} recipes.`,
    'Orble labels',
    8
  );
}

function buildPrintQueue_(dryRun) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sourceSheet = ss.getActiveSheet();
  const values = sourceSheet.getDataRange().getDisplayValues();
  if (values.length < 2) {
    throw new Error('Production plan has no rows.');
  }

  const headers = values[0].map(normalizeHeader_);
  const col = (name) => headers.indexOf(normalizeHeader_(name));
  const required = ['Recipe', 'Drink Variation', 'Amount to Make'];
  required.forEach((name) => {
    if (col(name) < 0) throw new Error(`Missing required column: ${name}`);
  });

  const recipeCol = col('Recipe');
  const drinkCol = col('Drink Variation');
  const amountToMakeCol = col('Amount to Make');
  const totalStickersCol = col('Total Stickers');
  const takeToMachineCol = col('Amount to Take to Machine');
  const slotTowneCol = col('Slot (Towne)');
  const slot30thCol = col('Slot (30TH)');
  const dateCol = firstExistingColumn_(headers, ['Date', 'Production Date', 'Print Date', 'Batch Date']);

  const now = new Date();
  const jobId = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  const createdAt = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  const outputRows = [];
  let currentRecipe = '';

  for (let r = 1; r < values.length; r += 1) {
    const row = values[r];
    const recipeCell = String(row[recipeCol] || '').trim();
    if (recipeCell) currentRecipe = recipeCell;
    const recipe = currentRecipe;
    const drinkName = String(row[drinkCol] || '').trim();
    if (!recipe || !drinkName) continue;

    const quantity =
      parseQuantity_(totalStickersCol >= 0 ? row[totalStickersCol] : '') ||
      parseQuantity_(row[amountToMakeCol]);
    if (quantity <= 0) continue;

    const directCount = parseQuantity_(takeToMachineCol >= 0 ? row[takeToMachineCol] : '');
    const batchDateValue = dateCol >= 0 ? row[dateCol] : '';
    const expirationDate = formatExpirationDate_(batchDateValue || now);
    const slots = machineSlots_(row, slot30thCol, slotTowneCol);

    for (let i = 0; i < quantity; i += 1) {
      const direct = i < directCount;
      const slot = slots[i % slots.length];
      const code = direct ? `D${slot.machine}#${slot.slot}` : '';
      outputRows.push([
        jobId,
        createdAt,
        recipe,
        '',
        '',
        code,
        expirationDate,
        drinkName,
        'QUEUED',
      ]);
    }
  }

  const countsByRecipe = {};
  outputRows.forEach((row) => {
    countsByRecipe[row[2]] = (countsByRecipe[row[2]] || 0) + 1;
  });
  const seenByRecipe = {};
  outputRows.forEach((row) => {
    const recipe = row[2];
    seenByRecipe[recipe] = (seenByRecipe[recipe] || 0) + 1;
    row[3] = seenByRecipe[recipe];
    row[4] = countsByRecipe[recipe];
  });

  if (!dryRun) {
    const queueSheet = getOrCreateQueueSheet_(ss);
    queueSheet.clearContents();
    queueSheet.getRange(1, 1, 1, QUEUE_HEADERS.length).setValues([QUEUE_HEADERS]);
    if (outputRows.length) {
      queueSheet.getRange(2, 1, outputRows.length, QUEUE_HEADERS.length).setValues(outputRows);
    }
    queueSheet.autoResizeColumns(1, QUEUE_HEADERS.length);
  }

  return {
    totalLabels: outputRows.length,
    recipeCount: Object.keys(countsByRecipe).length,
    jobId,
  };
}

function getOrCreateQueueSheet_(ss) {
  return ss.getSheetByName(PRINT_QUEUE_SHEET) || ss.insertSheet(PRINT_QUEUE_SHEET);
}

function normalizeHeader_(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function firstExistingColumn_(headers, names) {
  for (const name of names) {
    const index = headers.indexOf(normalizeHeader_(name));
    if (index >= 0) return index;
  }
  return -1;
}

function parseQuantity_(value) {
  const num = Number(String(value || '').trim());
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.ceil(num));
}

function formatExpirationDate_(value) {
  const date = value instanceof Date ? new Date(value) : parseDate_(value);
  date.setDate(date.getDate() + 7);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'MM/dd/yy');
}

function parseDate_(value) {
  const text = String(value || '').trim();
  if (!text) return new Date();
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (!match) throw new Error(`Could not parse date: ${text}`);
  const month = Number(match[1]) - 1;
  const day = Number(match[2]);
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  return new Date(year, month, day);
}

function machineSlots_(row, slot30thCol, slotTowneCol) {
  const slots = [];
  if (slot30thCol >= 0) {
    parseSlots_(row[slot30thCol]).forEach((slot) => slots.push({ machine: '30TH', slot }));
  }
  if (slotTowneCol >= 0) {
    parseSlots_(row[slotTowneCol]).forEach((slot) => slots.push({ machine: 'TWNE', slot }));
  }
  return slots.length ? slots : [{ machine: '30TH', slot: '00' }];
}

function parseSlots_(value) {
  const text = String(value || '');
  const matches = text.match(/\d+/g);
  return matches || [];
}
