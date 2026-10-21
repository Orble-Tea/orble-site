import { makeRasterBytes, renderLabel } from "./raster.js";
import { connectPrinter, transferToPrinter } from "./webusb.js";

export function startLabelPrinter() {
  const elements = getElements();
  const session = {
    connection: null,
    printing: false,
    planRows: [],
    totalLabels: 0,
  };
  const log = createLogger(elements.log);

  wireEvents(elements, session, log);
  renderLabel(elements.canvas, currentTestLabel(elements));
  updatePrintButtons(elements, session);
  refreshProductionPlan(elements, session, log).catch((error) => {
    log(`Production plan load failed: ${error.message}`);
    console.error(error);
  });
  autoConnectPrinter(elements, session, log);
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

function wireEvents(elements, session, log) {
  elements.connectButton.addEventListener("click", () =>
    connectAndStorePrinter(elements, session, log, { allowPrompt: true }).catch((error) => {
      log(`Connect failed: ${error.message}`);
      console.error(error);
    }),
  );

  elements.printOneButton.addEventListener("click", () =>
    runPrintJob(elements, session, elements.printOneButton, async () => {
      await ensurePrinterConnected(elements, session, log);
      await printLabels(elements, session, [currentTestLabel(elements)], log);
    }).catch((error) => {
      log(`Print failed: ${error.message}`);
      console.error(error);
    }),
  );

  elements.printSelectedButton.addEventListener("click", () =>
    runPrintJob(elements, session, elements.printSelectedButton, async () => {
      await ensurePrinterConnected(elements, session, log);
      const recipes = selectedRecipeGroups(session.planRows);
      const totalLabels = recipes.reduce((total, recipe) => total + recipe.labels.length, 0);
      log(`Printing ${totalLabels} selected labels across ${recipes.length} recipes.`);
      await printRecipeGroups(elements, session, recipes, log);
      log("Finished printing selected rows.");
    }).catch((error) => {
      log(`Print selected failed: ${error.message}`);
      console.error(error);
    }),
  );

  elements.reloadPlanButton.addEventListener("click", () =>
    refreshProductionPlan(elements, session, log).catch((error) => {
      log(`Reload failed: ${error.message}`);
      console.error(error);
    }),
  );

  elements.selectEverything.addEventListener("change", () => {
    session.planRows.forEach((row) => {
      row.selected = elements.selectEverything.checked;
    });
    renderPlanTable(elements, session);
  });

  elements.planRows.addEventListener("change", (event) => {
    if (!event.target.classList.contains("row-checkbox")) return;
    const index = Number(event.target.dataset.index);
    if (!Number.isInteger(index) || !session.planRows[index]) return;
    session.planRows[index].selected = event.target.checked;
    updateSelectionSummary(elements, session);
    renderFirstSelectedPreview(elements, session);
  });

  ["input", "change"].forEach((eventName) => {
    [elements.drinkName, elements.labelCode, elements.expirationDate].forEach((input) => {
      input.addEventListener(eventName, () =>
        renderLabel(elements.canvas, currentTestLabel(elements)),
      );
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

function currentTestLabel(elements) {
  return {
    code: elements.labelCode.value.trim(),
    expirationDate: elements.expirationDate.value.trim(),
    drinkName: elements.drinkName.value.trim(),
  };
}

async function refreshProductionPlan(elements, session, log) {
  elements.planRows.innerHTML = loadingRow("Loading production plan...");
  const plan = await loadProductionPlan();
  session.totalLabels = plan.totalLabels;
  session.planRows = plan.recipes.flatMap((recipe) =>
    recipe.rows.map((row) => ({
      ...row,
      selected: true,
    })),
  );
  log(`Loaded ${plan.totalLabels} labels across ${plan.recipeCount} recipes.`);
  renderPlanTable(elements, session);
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

function renderPlanTable(elements, session) {
  elements.planRows.innerHTML = session.planRows.map(rowHtml).join("");
  updateSelectionSummary(elements, session);
  renderFirstSelectedPreview(elements, session);
}

function rowHtml(row, index) {
  return `
    <tr>
      <td class="w-12 border-b border-default py-2.5 pl-6 pr-0 align-top">
        <input class="row-checkbox h-[18px] w-[18px] accent-primary" type="checkbox" data-index="${index}" ${row.selected ? "checked" : ""} aria-label="Select ${escapeHtml(row.drinkName)}" />
      </td>
      <td class="border-b border-default px-2.5 py-2.5 align-top text-default">${escapeHtml(row.drinkName)}</td>
      <td class="orble-table-number whitespace-nowrap border-b border-default px-2.5 py-2.5 align-top text-default">${row.totalLabels}</td>
      <td class="orble-table-number whitespace-nowrap border-b border-default px-2.5 py-2.5 align-top text-default">${row.directLabels}</td>
      <td class="orble-table-number whitespace-nowrap border-b border-default px-2.5 py-2.5 align-top text-default">${row.storageLabels}</td>
    </tr>
  `;
}

function loadingRow(message) {
  return `<tr><td class="border-b border-default px-2.5 py-3 text-default" colspan="5">${message}</td></tr>`;
}

function updateSelectionSummary(elements, session) {
  const selectedRows = session.planRows.filter((row) => row.selected);
  const selectedLabels = selectedRows.reduce((total, row) => total + row.labels.length, 0);
  elements.selectedLabelCount.textContent = selectedLabels;
  elements.planLabelCount.textContent = session.totalLabels;
  elements.selectEverything.checked =
    selectedRows.length > 0 && selectedRows.length === session.planRows.length;
  elements.selectEverything.indeterminate =
    selectedRows.length > 0 && selectedRows.length < session.planRows.length;
  updatePrintButtons(elements, session);
}

function renderFirstSelectedPreview(elements, session) {
  const firstSelectedLabel = session.planRows.find((row) => row.selected)?.labels?.[0];
  if (firstSelectedLabel) {
    renderLabel(elements.canvas, firstSelectedLabel);
  }
}

function selectedRecipeGroups(planRows) {
  const groups = new Map();
  for (const row of planRows) {
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

async function autoConnectPrinter(elements, session, log) {
  try {
    await connectAndStorePrinter(elements, session, log, { allowPrompt: false });
  } catch {
    log("Printer permission not saved yet. The browser will ask when you connect or print.");
  }
}

async function ensurePrinterConnected(elements, session, log) {
  if (session.connection) return;
  await connectAndStorePrinter(elements, session, log, { allowPrompt: true });
}

async function connectAndStorePrinter(elements, session, log, options) {
  session.connection = await connectPrinter(options);
  elements.status.textContent = `Connected: ${session.connection.device.productName || "Brother printer"}`;
  elements.connectButton.textContent = "QL-600 Connected";
  updatePrintButtons(elements, session);
  log(
    `Connected interface ${session.connection.interfaceNumber}, OUT endpoint ${session.connection.endpointNumber}.`,
  );
}

async function printRecipeGroups(elements, session, recipes, log) {
  for (const recipe of recipes) {
    if (!recipe.labels?.length) continue;
    log(`Printing ${recipe.recipe}: ${recipe.labels.length} labels.`);
    await printLabels(elements, session, recipe.labels, log);
  }
}

async function printLabels(elements, session, labels, log) {
  const payload = makeRasterBytes(elements.canvas, labels, { cut: true });
  const result = await transferToPrinter(session.connection, payload);
  log(`Sent ${payload.byteLength} bytes. Transfer status: ${result.status}.`);
}

async function runPrintJob(elements, session, button, callback) {
  if (session.printing) {
    throw new Error("A print job is already running.");
  }
  session.printing = true;
  const previousText = button.textContent;
  updatePrintButtons(elements, session);
  button.textContent = "Printing...";
  try {
    await callback();
  } finally {
    session.printing = false;
    button.textContent = previousText;
    updatePrintButtons(elements, session);
  }
}

function updatePrintButtons(elements, session) {
  const hasSelectedRows = session.planRows.some((row) => row.selected);
  elements.printOneButton.disabled = session.printing;
  elements.printSelectedButton.disabled = session.printing || !hasSelectedRows;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
