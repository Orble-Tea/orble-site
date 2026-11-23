var VALIDATED_PLAN_SHEET = "Validated Production Plan";
var PLAN_REFRESH_MINUTES = 5;
var PLAN_LOCK_TIMEOUT_MS = 30000;

function readValidatedProductionPlanValues_(ss) {
  var sheet = ss.getSheetByName("Production Plan");
  if (!sheet) throw new Error("Missing Production Plan sheet.");
  var values = sheet.getDataRange().getValues();
  return SlotValidation.validatedProductionPlanValues(values);
}

function loadProductionPlan(ss) {
  return SlotValidation.parseProductionPlan(
    readValidatedProductionPlanValues_(ss),
  );
}

function getDrinkSlotCapacity_(item) {
  return SlotValidation.slotCapacityForDrink(item.variation);
}

function beverageProductionPlan_(productionPlan) {
  return productionPlan.filter(function (item) {
    return !SlotValidation.isBobaPack(item.variation);
  });
}

function validate(productionPlan, recipes, constants) {
  productionPlan = beverageProductionPlan_(productionPlan);
  var errors = [];
  for (var i = 0; i < productionPlan.length; i++) {
    var item = productionPlan[i];
    var prefix = "Row " + item.rowNumber + ": ";
    if (!recipes[item.recipe])
      errors.push(
        prefix + 'Recipe "' + item.recipe + '" not found in Recipes sheet.',
      );
    var size = extractSize(item.variation);
    if (!size)
      errors.push(
        prefix + 'Could not determine size from "' + item.variation + '".',
      );
    else if (getWaterVolume_(size, constants) === null)
      errors.push(prefix + "No water volume configured for " + size + ".");
    if (item.topping && !constants.toppings[item.topping])
      errors.push(
        prefix + 'Topping "' + item.topping + '" not found in Constants sheet.',
      );
  }
  var availableVolume = constants.containers.reduce(function (
    total,
    container,
  ) {
    return total + container.maxFill * container.quantity;
  }, 0);
  var batches = calculateBatches(productionPlan, constants, true);
  Object.keys(batches).forEach(function (name) {
    if (batches[name].totalVolume > availableVolume)
      errors.push(
        'Batch "' + name + '" exceeds configured container capacity.',
      );
  });
  return errors;
}

function publishValidatedProductionPlan_(ss, values) {
  var sheet =
    ss.getSheetByName(VALIDATED_PLAN_SHEET) ||
    ss.insertSheet(VALIDATED_PLAN_SHEET);
  sheet.clearContents();
  var width = values[0].length;
  if (sheet.getMaxRows() < values.length)
    sheet.insertRowsAfter(
      sheet.getMaxRows(),
      values.length - sheet.getMaxRows(),
    );
  if (sheet.getMaxColumns() < width)
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      width - sheet.getMaxColumns(),
    );
  sheet.getRange(1, 1, values.length, width).setValues(
    values.map(function (row) {
      return Array.from({ length: width }, function (_, index) {
        return row[index] === undefined ? "" : row[index];
      });
    }),
  );
}

function invalidatePublishedProductionPlan_(ss, error) {
  var sheet =
    ss.getSheetByName(VALIDATED_PLAN_SHEET) ||
    ss.insertSheet(VALIDATED_PLAN_SHEET);
  if (sheet) {
    sheet.clearContents();
    sheet
      .getRange(1, 1, 2, 1)
      .setValues([["INVALID_PRODUCTION_PLAN"], [String(error.message)]]);
  }
}

function refreshValidatedProductionPlan() {
  var lock = LockService.getScriptLock();
  lock.waitLock(PLAN_LOCK_TIMEOUT_MS);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    var values = readValidatedProductionPlanValues_(ss);
    publishValidatedProductionPlan_(ss, values);
  } catch (error) {
    invalidatePublishedProductionPlan_(ss, error);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function refreshProductionPlanOnEdit() {
  refreshValidatedProductionPlan();
}

function migrateLiveInventoryImports_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var constants = loadConstants(ss);
  var inventoryId = getConfigString_(
    constants,
    "Inventory Sheet ID",
    DEFAULT_APP_CONFIG.inventorySheetId,
  );
  SpreadsheetApp.openById(inventoryId)
    .getSheets()
    .forEach(function (sheet) {
      sheet
        .getDataRange()
        .getFormulas()
        .forEach(function (row, rowIndex) {
          row.forEach(function (formula, columnIndex) {
            if (
              formula.indexOf(ss.getId()) !== -1 &&
              formula.indexOf("'Production Plan'!") !== -1
            ) {
              sheet
                .getRange(rowIndex + 1, columnIndex + 1)
                .setFormula(
                  formula
                    .split("'Production Plan'!")
                    .join("'" + VALIDATED_PLAN_SHEET + "'!"),
                );
            }
          });
        });
    });
}

function installProductionPlanValidationTriggers() {
  var handlers = [
    "refreshProductionPlanOnEdit",
    "refreshValidatedProductionPlan",
  ];
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) !== -1)
      ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("refreshProductionPlanOnEdit")
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();
  ScriptApp.newTrigger("refreshValidatedProductionPlan")
    .timeBased()
    .everyMinutes(PLAN_REFRESH_MINUTES)
    .create();
  migrateLiveInventoryImports_();
  refreshValidatedProductionPlan();
}

function getValidatedInventoryPlan_(ss, recipes, constants) {
  var lock = LockService.getScriptLock();
  lock.waitLock(PLAN_LOCK_TIMEOUT_MS);
  try {
    var values = readValidatedProductionPlanValues_(ss);
    var errors = validate(
      SlotValidation.parseProductionPlan(values),
      recipes,
      constants,
    );
    if (errors.length) throw new Error(errors.join("\n"));
    publishValidatedProductionPlan_(ss, values);
    return values;
  } catch (error) {
    invalidatePublishedProductionPlan_(ss, error);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function buildProductionPlanColumnImport_(sourceSpreadsheetId, columnIndex) {
  var columnLetter = columnToLetter_(columnIndex);
  return (
    'IMPORTRANGE("' +
    sourceSpreadsheetId +
    '", "\'' +
    VALIDATED_PLAN_SHEET +
    "'!" +
    columnLetter +
    ":" +
    columnLetter +
    '")'
  );
}
