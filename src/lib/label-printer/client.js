import { makeRasterBytes, renderLabel } from "./raster.js";
import { connectPrinter, transferToPrinter } from "./webusb.js";

const state = {
  connection: null,
  printing: false,
  plan: null,
  planRows: [],
};

export function startLabelPrinter() {
  const el = getElements();
  const log = createLogger(el.log);

  wireEvents(el, log);
  renderLabel(el.canvas, currentTestLabel(el));
  updatePrintButtons(el);
  refreshProductionPlan(el, log).catch((error) => {
    log(`Production plan load failed: ${error.message}`);
    console.error(error);
  });
  autoConnectPrinter(el, log);
  log("Ready. If this browser has printer permission saved, it will reconnect automatically.");
}

function getElements() {
  return {
    status: document.getElementById("connectionStatus"),
    log: document.getElementById("log"),
    canvas: document.getElementById("preview"),
    drinkName: document.getElementById("drinkName"),
    labelCode: document.getElementById("labelCode"),
    expirationDate: document.getElementById("expirationDate"),
    planRows: document.getElementById("planRows"),
    selectEverything: document.getElementById("selectEverything"),
    selectedLabelCount: document.getElementById("selectedLabelCount"),
    planLabelCount: document.getElementById("planLabelCount"),
    connectButton: document.getElementById("connectButton"),
    printOneButton: document.getElementById("printOneButton"),
    printSelectedButton: document.getElementById("printSelectedButton"),
    reloadPlanButton: document.getElementById("reloadPlanButton"),
  };
}

function wireEvents(el, log) {
  el.connectButton.addEventListener("click", () =>
    connectAndStorePrinter(el, log, { allowPrompt: true }).catch((error) => {
      log(`Connect failed: ${error.message}`);
      console.error(error);
    }),
  );

  el.printOneButton.addEventListener("click", () =>
    runPrintJob(el, el.printOneButton, async () => {
      await ensurePrinterConnected(el, log);
      await printLabels(el, [currentTestLabel(el)], log);
    }).catch((error) => {
      log(`Print failed: ${error.message}`);
      console.error(error);
    }),
  );

  el.printSelectedButton.addEventListener("click", () =>
    runPrintJob(el, el.printSelectedButton, async () => {
      await ensurePrinterConnected(el, log);
      const recipes = selectedRecipeGroups();
      const totalLabels = recipes.reduce((total, recipe) => total + recipe.labels.length, 0);
      log(`Printing ${totalLabels} selected labels across ${recipes.length} recipes.`);
      await printRecipeGroups(el, recipes, log);
      log("Finished printing selected rows.");
    }).catch((error) => {
      log(`Print selected failed: ${error.message}`);
      console.error(error);
    }),
  );

  el.reloadPlanButton.addEventListener("click", () =>
    refreshProductionPlan(el, log).catch((error) => {
      log(`Reload failed: ${error.message}`);
      console.error(error);
    }),
  );

  el.selectEverything.addEventListener("change", () => {
    state.planRows.forEach((row) => {
      row.selected = el.selectEverything.checked;
    });
    renderPlanTable(el);
  });

  el.planRows.addEventListener("change", (event) => {
    if (!event.target.classList.contains("row-checkbox")) return;
    const index = Number(event.target.dataset.index);
    if (!Number.isInteger(index) || !state.planRows[index]) return;
    state.planRows[index].selected = event.target.checked;
    updateSelectionSummary(el);
    renderFirstSelectedPreview(el);
  });

  ["input", "change"].forEach((eventName) => {
    [el.drinkName, el.labelCode, el.expirationDate].forEach((input) => {
      input.addEventListener(eventName, () => renderLabel(el.canvas, currentTestLabel(el)));
    });
  });
}

function createLogger(logElement) {
  return (message) => {
    const timestamp = new Date().toLocaleTimeString();
    logElement.textContent += `[${timestamp}] ${message}\n`;
    logElement.scrollTop = logElement.scrollHeight;
  };
}

function currentTestLabel(el) {
  return {
    code: el.labelCode.value.trim(),
    expirationDate: el.expirationDate.value.trim(),
    drinkName: el.drinkName.value.trim(),
  };
}

async function refreshProductionPlan(el, log) {
  el.planRows.innerHTML = `<tr><td colspan="6">Loading production plan...</td></tr>`;
  const plan = await loadProductionPlan();
  state.plan = plan;
  state.planRows = plan.recipes.flatMap((recipe, recipeIndex) =>
    (recipe.rows || []).map((row, rowIndex) => ({
      ...row,
      id: row.id || `${recipe.recipe}-${recipeIndex}-${rowIndex}`,
      selected: true,
    })),
  );
  log(`Loaded ${plan.totalLabels} labels across ${plan.recipeCount} recipes.`);
  renderPlanTable(el);
}

async function loadProductionPlan() {
  const response = await fetch(`/api/label-print-data?${new URLSearchParams(window.location.search)}`, {
    headers: { Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Could not load production plan labels.");
  }
  if (!Array.isArray(payload.recipes) || payload.recipes.length === 0) {
    throw new Error("Production plan did not return any labels.");
  }
  return payload;
}

function renderPlanTable(el) {
  if (state.planRows.length === 0) {
    el.planRows.innerHTML = `<tr><td colspan="6">No production-plan labels found.</td></tr>`;
    updateSelectionSummary(el);
    return;
  }

  el.planRows.innerHTML = state.planRows
    .map(
      (row, index) => `
        <tr>
          <td class="checkbox-cell">
            <input class="row-checkbox" type="checkbox" data-index="${index}" ${row.selected ? "checked" : ""} aria-label="Select ${escapeHtml(row.drinkName)}" />
          </td>
          <td>${escapeHtml(row.recipe)}</td>
          <td>${escapeHtml(row.drinkName)}</td>
          <td class="number-cell">${row.totalLabels}</td>
          <td class="number-cell">${row.directLabels}</td>
          <td class="number-cell">${row.storageLabels}</td>
        </tr>
      `,
    )
    .join("");
  updateSelectionSummary(el);
  renderFirstSelectedPreview(el);
}

function updateSelectionSummary(el) {
  const selectedRows = state.planRows.filter((row) => row.selected);
  const selectedLabels = selectedRows.reduce((total, row) => total + row.labels.length, 0);
  const totalLabels = state.plan?.totalLabels || 0;
  el.selectedLabelCount.textContent = selectedLabels;
  el.planLabelCount.textContent = totalLabels;
  el.selectEverything.checked =
    selectedRows.length > 0 && selectedRows.length === state.planRows.length;
  el.selectEverything.indeterminate =
    selectedRows.length > 0 && selectedRows.length < state.planRows.length;
  updatePrintButtons(el);
}

function renderFirstSelectedPreview(el) {
  const firstSelectedLabel = state.planRows.find((row) => row.selected)?.labels?.[0];
  if (firstSelectedLabel) {
    renderLabel(el.canvas, firstSelectedLabel);
  }
}

function selectedRecipeGroups() {
  const groups = new Map();
  for (const row of state.planRows) {
    if (!row.selected) continue;
    if (!groups.has(row.recipe)) {
      groups.set(row.recipe, { recipe: row.recipe, labels: [] });
    }
    groups.get(row.recipe).labels.push(...row.labels);
  }
  const recipes = Array.from(groups.values()).filter((recipe) => recipe.labels.length > 0);
  if (recipes.length === 0) {
    throw new Error("No production-plan rows are selected.");
  }
  return recipes;
}

async function autoConnectPrinter(el, log) {
  try {
    await connectAndStorePrinter(el, log, { allowPrompt: false });
  } catch {
    log("Printer permission not saved yet. The browser will ask when you connect or print.");
  }
}

async function ensurePrinterConnected(el, log) {
  if (state.connection) return;
  await connectAndStorePrinter(el, log, { allowPrompt: true });
}

async function connectAndStorePrinter(el, log, options) {
  state.connection = await connectPrinter(options);
  el.status.textContent = `Connected: ${state.connection.device.productName || "Brother printer"}`;
  el.connectButton.textContent = "QL-600 Connected";
  updatePrintButtons(el);
  log(
    `Connected interface ${state.connection.interfaceNumber}, OUT endpoint ${state.connection.endpointNumber}.`,
  );
}

async function printRecipeGroups(el, recipes, log) {
  for (const recipe of recipes) {
    if (!recipe.labels?.length) continue;
    log(`Printing ${recipe.recipe}: ${recipe.labels.length} labels.`);
    await printLabels(el, recipe.labels, log);
  }
}

async function printLabels(el, labels, log) {
  const payload = makeRasterBytes(el.canvas, labels, { cut: true });
  const result = await transferToPrinter(state.connection, payload);
  log(`Sent ${payload.byteLength} bytes. Transfer status: ${result.status}.`);
}

async function runPrintJob(el, button, callback) {
  if (state.printing) {
    throw new Error("A print job is already running.");
  }
  state.printing = true;
  const previousText = button.textContent;
  updatePrintButtons(el);
  button.textContent = "Printing...";
  try {
    await callback();
  } finally {
    state.printing = false;
    button.textContent = previousText;
    updatePrintButtons(el);
  }
}

function updatePrintButtons(el) {
  const hasSelectedRows = state.planRows.some((row) => row.selected);
  el.printOneButton.disabled = state.printing;
  el.printSelectedButton.disabled = state.printing || !hasSelectedRows;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
