import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
export const SCRIPT_ID =
  "18AccUWaq8ldc2C_z12L42QFxAr3n44vC3YZegFkLTaLH75Cx4Pw6veZX";

export async function prepareAppsScript(directory) {
  const adapter = await readFile(
    path.join(root, "apps-script/PlanAccess.gs"),
    "utf8",
  );
  const adapterAst = ts.createSourceFile(
    "PlanAccess.js",
    adapter,
    ts.ScriptTarget.Latest,
    true,
  );
  const replacements = new Set(
    adapterAst.statements
      .filter(ts.isFunctionDeclaration)
      .map((node) => node.name.text),
  );
  const removedHelpers = new Set([
    "isNonnegativeIntegerValue_",
    "readInteger_",
    "isSlotListValueValid_",
    "readSlots_",
    "isProductionPlanStopRow_",
    "isBobaPack_",
  ]);
  const required = new Set([
    "loadProductionPlan",
    "validate",
    "getDrinkSlotCapacity_",
    "buildProductionPlanColumnImport_",
  ]);
  const files = await readdir(directory);
  if (!files.includes("appsscript.json"))
    throw new Error("Run clasp pull before preparing the project.");
  const manifest = JSON.parse(
    await readFile(path.join(directory, "appsscript.json"), "utf8"),
  );
  manifest.runtimeVersion = "V8";
  const triggerScope = "https://www.googleapis.com/auth/script.scriptapp";
  if (
    Array.isArray(manifest.oauthScopes) &&
    !manifest.oauthScopes.includes(triggerScope)
  )
    manifest.oauthScopes.push(triggerScope);
  const edits = new Map();
  let inventoryPatched = false;
  for (const name of files.filter(
    (name) =>
      /\.(gs|js)$/.test(name) &&
      ![
        "PlanAccess.gs",
        "PlanAccess.js",
        "SlotValidation.js",
        "SlotValidation.gs",
      ].includes(name),
  )) {
    let source = await readFile(path.join(directory, name), "utf8");
    const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
    const removals = ast.statements.filter(
      (node) =>
        (ts.isFunctionDeclaration(node) &&
          (replacements.has(node.name.text) ||
            removedHelpers.has(node.name.text))) ||
        (ts.isVariableStatement(node) &&
          node.declarationList.declarations.length === 1 &&
          node.declarationList.declarations[0].name.getText(ast) ===
            "MACHINE_CONFIG"),
    );
    const sourceEdits = removals.map((node) => [
      node.getStart(ast),
      node.end,
      "",
    ]);
    const batches = ast.statements.find(
      (node) =>
        ts.isFunctionDeclaration(node) && node.name.text === "calculateBatches",
    );
    if (
      batches?.body &&
      !batches.getText(ast).includes("beverageProductionPlan_(productionPlan)")
    ) {
      const position = batches.body.getStart(ast) + 1;
      sourceEdits.push([
        position,
        position,
        "\n  productionPlan = beverageProductionPlan_(productionPlan);\n",
      ]);
    }
    for (const node of removals) {
      if (ts.isFunctionDeclaration(node)) required.delete(node.name.text);
    }
    for (const [start, end, replacement] of sourceEdits.sort(
      (left, right) => right[0] - left[0],
    ))
      source = source.slice(0, start) + replacement + source.slice(end);
    if (source.includes("function updateInventory(")) {
      const rawRead = "var planData = planSheet.getDataRange().getValues();";
      const guardedRead =
        "var planData = getValidatedInventoryPlan_(ss, recipes, constants);\n  productionPlan = SlotValidation.parseProductionPlan(planData);";
      if (!source.includes(rawRead) && !source.includes(guardedRead))
        throw new Error(
          "updateInventory changed. Review its plan reads before deploying.",
        );
      source = source.replace(rawRead, guardedRead);
      inventoryPatched = true;
    }
    const updatedAst = ts.createSourceFile(
      name,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const configEdits = [];
    function inspect(node) {
      if (
        ts.isVariableDeclaration(node) &&
        node.name.getText(updatedAst) === "DEFAULT_APP_CONFIG" &&
        node.initializer &&
        ts.isObjectLiteralExpression(node.initializer)
      ) {
        const properties = node.initializer.properties.filter(
          (property) =>
            !["defaultSlotCapacity", "bobaSlotCapacity"].includes(
              property.name?.getText(updatedAst),
            ),
        );
        const object = ts.factory.updateObjectLiteralExpression(
          node.initializer,
          properties,
        );
        configEdits.push([
          node.initializer.getStart(updatedAst),
          node.initializer.end,
          ts
            .createPrinter()
            .printNode(ts.EmitHint.Expression, object, updatedAst),
        ]);
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "getSheetByName" &&
        node.arguments[0]?.text === "Production Plan"
      ) {
        let parent = node.parent;
        while (parent && !ts.isFunctionDeclaration(parent))
          parent = parent.parent;
        if (parent?.name?.text !== "updateInventory")
          throw new Error(`Unreviewed Production Plan reader in ${name}.`);
      }
      ts.forEachChild(node, inspect);
    }
    inspect(updatedAst);
    for (const [start, end, replacement] of configEdits.reverse())
      source = source.slice(0, start) + replacement + source.slice(end);
    edits.set(name, source);
  }
  const alreadyPrepared = files.some((name) =>
    /^PlanAccess\.(gs|js)$/.test(name),
  );
  if ((!alreadyPrepared && required.size) || !inventoryPatched)
    throw new Error(
      `Unexpected Apps Script structure. Missing ${[...required].join(", ")} or updateInventory.`,
    );
  for (const [name, source] of edits) {
    for (const helper of removedHelpers) {
      if (new RegExp(`\\b${helper}\\s*\\(`).test(source)) {
        throw new Error(
          `Review remaining call to ${helper} in ${name} before deploying.`,
        );
      }
    }
  }
  const bundle = await build({
    entryPoints: [path.join(root, "src/lib/production-plan.js")],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "SlotValidation",
    target: "es2019",
  });
  for (const [name, source] of edits)
    await writeFile(path.join(directory, name), source);
  await writeFile(
    path.join(directory, "appsscript.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await writeFile(path.join(directory, "PlanAccess.js"), adapter);
  const machineConfig = `\nvar MACHINE_CONFIG = SlotValidation.PLAN_MACHINES.map(function(machine) {\n  return {label: machine.label, amountHeader: 'Amount to ' + machine.label, slotHeader: 'Slot (' + machine.label + ')'};\n});\n`;
  await writeFile(
    path.join(directory, "SlotValidation.js"),
    bundle.outputFiles[0].text + machineConfig,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = path.resolve(
    process.argv[2] || path.join(root, ".apps-script"),
  );
  if (process.argv.includes("--init")) {
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, ".clasp.json"),
      JSON.stringify({ scriptId: SCRIPT_ID, rootDir: "." }, null, 2),
    );
  } else {
    await prepareAppsScript(directory);
  }
}
