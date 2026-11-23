import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { build } from "esbuild";
import { prepareAppsScript } from "../../scripts/prepare-apps-script.mjs";

const headers = [
  "Recipe",
  "Drink Variation",
  "Amount to Make",
  "Amount to 30th",
  "Slot (30th)",
  "Amount to Towne",
  "Slot (Towne)",
];
const values = () => [headers, ["Tea", "Thai Tea 16oz", 4, 4, "1", 0, ""]];
const directories = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function scriptContext() {
  const bundle = await build({
    entryPoints: ["src/lib/production-plan.js"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "SlotValidation",
    target: "es2019",
  });
  const context = vm.createContext({});
  vm.runInContext(
    bundle.outputFiles[0].text +
      "\n" +
      (await readFile("apps-script/PlanAccess.gs", "utf8")),
    context,
  );
  return context;
}

describe("Apps Script shared validator integration", () => {
  it("validates and publishes Boba Pack while excluding it only from beverage recipes", async () => {
    const context = await scriptContext();
    const plan = [
      [...headers, "Total Stickers"],
      ["Tea", "Thai Tea 16oz", 4, 4, "1", 0, "", 4],
      ["", "", 4, "", "", "", "", 4],
      ["Topping", "Boba Pack", 6, 6, "3", 0, ""],
      ["Tea", "Matcha 16oz", 4, 0, "", 4, "2", 4],
      ["Catering"],
    ];
    const setValues = vi.fn();
    const mirror = {
      clearContents() {},
      getMaxRows: () => 100,
      getMaxColumns: () => 26,
      getRange: () => ({ setValues }),
    };
    const ss = {
      getSheetByName: (name) =>
        name === "Production Plan"
          ? { getDataRange: () => ({ getValues: () => plan }) }
          : mirror,
    };
    context.SpreadsheetApp = { getActiveSpreadsheet: () => ss };
    context.LockService = {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} }),
    };
    const loaded = context.loadProductionPlan(ss);
    expect(loaded.map((item) => item.variation)).toEqual([
      "Thai Tea 16oz",
      "Boba Pack",
      "Matcha 16oz",
    ]);
    expect(loaded[1]).toMatchObject({
      recipe: "Topping",
      rowNumber: 4,
      amountToMake: 6,
    });
    expect(
      context.beverageProductionPlan_(loaded).map((item) => item.variation),
    ).toEqual(["Thai Tea 16oz", "Matcha 16oz"]);
    context.calculateBatches = vi.fn(() => ({}));
    expect(
      context.validate([loaded[1]], {}, { containers: [], toppings: {} }),
    ).toEqual([]);
    expect(context.calculateBatches.mock.calls[0][0]).toEqual([]);
    context.refreshValidatedProductionPlan();
    const published = setValues.mock.calls[0][0];
    expect(published[2]).toEqual(Array(plan[0].length).fill(""));
    expect(published[3][1]).toBe("Boba Pack");
    expect(published[4][1]).toBe("Matcha 16oz");
  });
  it("publishes values from a single validated read and keeps blank rows aligned", async () => {
    const context = await scriptContext();
    const plan = [
      headers,
      ["Tea"],
      [],
      ["", "Thai Tea 16oz", 4, 4, "1", 0, ""],
    ];
    const getValues = vi.fn(() => plan);
    const setValues = vi.fn();
    const mirror = {
      clearContents: vi.fn(),
      getMaxRows: () => 100,
      getMaxColumns: () => 26,
      getRange: () => ({ setValues }),
    };
    const ss = {
      getSheetByName: (name) =>
        name === "Production Plan"
          ? { getDataRange: () => ({ getValues }) }
          : mirror,
    };
    context.SpreadsheetApp = { getActiveSpreadsheet: () => ss };
    context.LockService = {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} }),
    };
    context.refreshValidatedProductionPlan();
    expect(getValues).toHaveBeenCalledOnce();
    expect(setValues.mock.calls[0][0]).toHaveLength(4);
    expect(setValues.mock.calls[0][0][3][1]).toBe("Thai Tea 16oz");
    expect(setValues.mock.calls[0][0][2]).toEqual(
      Array(headers.length).fill(""),
    );
  });

  it("migrates only this workbook's raw plan imports", async () => {
    const context = await scriptContext();
    const setFormula = vi.fn();
    const ss = { getId: () => "source-sheet" };
    context.SpreadsheetApp = {
      getActiveSpreadsheet: () => ss,
      openById: () => ({
        getSheets: () => [
          {
            getDataRange: () => ({
              getFormulas: () => [
                [
                  '=IMPORTRANGE("source-sheet", "\'Production Plan\'!A:A")',
                  '=IMPORTRANGE("other-sheet", "\'Production Plan\'!A:A")',
                  "=SUM(A1:A5)",
                ],
              ],
            }),
            getRange: () => ({ setFormula }),
          },
        ],
      }),
    };
    context.loadConstants = () => ({});
    context.getConfigString_ = () => "inventory-sheet";
    context.DEFAULT_APP_CONFIG = {};
    context.migrateLiveInventoryImports_();
    expect(setFormula).toHaveBeenCalledOnce();
    expect(setFormula.mock.calls[0][0]).toContain("Validated Production Plan");
  });
  it("runs the website rules in Apps Script and guards the loader", async () => {
    const context = await scriptContext();
    context.columnToLetter_ = () => "A";
    const plan = values();
    const ss = {
      getSheetByName: () => ({
        getDataRange: () => ({ getValues: () => plan }),
      }),
    };
    expect(context.loadProductionPlan(ss)[0].variation).toBe("Thai Tea 16oz");
    plan[1][4] = "1,garbage";
    expect(() => context.loadProductionPlan(ss)).toThrow(
      "slots must be integers",
    );
    expect(context.buildProductionPlanColumnImport_("sheet", 0)).toContain(
      "Validated Production Plan",
    );
  });

  it("clears published quantities on invalid edits and releases its lock", async () => {
    const context = await scriptContext();
    const plan = values();
    plan[1][3] = 5;
    const setValues = vi.fn();
    const clearContents = vi.fn();
    const sheet = { clearContents, getRange: () => ({ setValues }) };
    const ss = {
      getSheetByName: (name) =>
        name === "Production Plan"
          ? { getDataRange: () => ({ getValues: () => plan }) }
          : sheet,
    };
    const lock = { waitLock: vi.fn(), releaseLock: vi.fn() };
    context.LockService = { getScriptLock: () => lock };
    context.SpreadsheetApp = { getActiveSpreadsheet: () => ss };
    expect(() => context.refreshValidatedProductionPlan()).toThrow("capacity");
    expect(clearContents).toHaveBeenCalledOnce();
    expect(setValues.mock.calls[0][0][0]).toEqual(["INVALID_PRODUCTION_PLAN"]);
    expect(lock.releaseLock).toHaveBeenCalledOnce();
  });

  it("preserves existing project files, replaces old validation and prepares idempotently", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "orble-script-"));
    directories.push(directory);
    await writeFile(
      path.join(directory, "appsscript.json"),
      '{"runtimeVersion":"V8"}',
    );
    await writeFile(
      path.join(directory, "Config.js"),
      `var MACHINE_CONFIG = [{label: 'Legacy'}];
var DEFAULT_APP_CONFIG = {inventorySheetId: 'keep', defaultSlotCapacity: 99, bobaSlotCapacity: 99};`,
    );
    await writeFile(
      path.join(directory, "Existing.js"),
      `function loadProductionPlan(ss) { return []; }
function validate(plan) { return ['old slot rules']; }
function getDrinkSlotCapacity_(item) { return 99; }
function buildProductionPlanColumnImport_() { return 'raw import'; }
function updateInventory() { var planData = planSheet.getDataRange().getValues(); }
function calculateBatches(productionPlan) { return productionPlan.map(function(item) { return item.variation; }); }
function unrelated() { return 'preserved'; }`,
    );
    await prepareAppsScript(directory);
    const source = await readFile(path.join(directory, "Existing.js"), "utf8");
    expect(source).toContain("function unrelated()");
    expect(source).toContain("getValidatedInventoryPlan_");
    expect(source).not.toContain("old slot rules");
    const config = await readFile(path.join(directory, "Config.js"), "utf8");
    expect(config).not.toContain("MACHINE_CONFIG");
    expect(config).not.toContain("SlotCapacity");
    expect(config).toContain("inventorySheetId");
    const firstAdapter = await readFile(
      path.join(directory, "PlanAccess.js"),
      "utf8",
    );
    await prepareAppsScript(directory);
    expect(await readFile(path.join(directory, "PlanAccess.js"), "utf8")).toBe(
      firstAdapter,
    );
    const context = vm.createContext({});
    vm.runInContext(
      await readFile(path.join(directory, "SlotValidation.js"), "utf8"),
      context,
    );
    vm.runInContext(
      await readFile(path.join(directory, "PlanAccess.js"), "utf8"),
      context,
    );
    vm.runInContext(
      await readFile(path.join(directory, "Existing.js"), "utf8"),
      context,
    );
    expect(
      context.calculateBatches([
        { variation: "Tea 16oz" },
        { variation: "Boba Pack" },
      ]),
    ).toEqual(["Tea 16oz"]);
    expect(context.SlotValidation.parseProductionPlan(values())).toHaveLength(
      1,
    );
    expect(context.MACHINE_CONFIG.map((machine) => machine.label)).toEqual([
      "30th",
      "Towne",
    ]);
  });

  it("refuses an unfamiliar project without writing changes", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "orble-script-"));
    directories.push(directory);
    await writeFile(path.join(directory, "appsscript.json"), "{}");
    await writeFile(
      path.join(directory, "Unknown.js"),
      "function unrelated() {}",
    );
    await expect(prepareAppsScript(directory)).rejects.toThrow(
      "Unexpected Apps Script structure",
    );
    expect(await readFile(path.join(directory, "Unknown.js"), "utf8")).toBe(
      "function unrelated() {}",
    );
  });
});
