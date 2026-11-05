import { makeRasterBytes, renderLabel } from "./raster.js";
import { connectPrinter, transferToPrinter } from "./webusb.js";

/** Initializes one printer page, its selection, preview dialog, and USB connection. */
export function startLabelPrinter() {
  const elements = Object.fromEntries(
    [
      "connectionStatus",
      "log",
      "planRows",
      "selectEverything",
      "selectedLabelCount",
      "planLabelCount",
      "connectButton",
      "printSelectedButton",
      "reloadPlanButton",
      "printDialog",
      "previewLabels",
      "confirmPrintButton",
      "cancelPrintButton",
      "previewCount",
      "printStatus",
    ].map((id) => [id, document.getElementById(id)]),
  );
  const session = {
    connection: null,
    printing: false,
    loading: false,
    rows: [],
    preview: [],
  };
  const log = createLogger(elements.log);

  elements.connectButton.addEventListener("click", async () => {
    try {
      await connectAndStorePrinter(elements, session, true);
      log("Printer connected.");
    } catch (error) {
      console.error(error);
      log(
        "Could not connect. Check USB, close other printer apps, and select the QL-600.",
      );
    }
  });
  elements.reloadPlanButton.addEventListener("click", () =>
    refreshProductionPlan(elements, session, log),
  );
  elements.selectEverything.addEventListener("change", () => {
    session.rows.forEach((row) => {
      row.selected = elements.selectEverything.checked;
    });
    renderPlanTable(elements, session);
  });
  elements.planRows.addEventListener("change", (event) => {
    const index = Number(event.target.dataset.index);
    if (!event.target.matches(".row-checkbox") || !session.rows[index]) return;
    session.rows[index].selected = event.target.checked;
    updateSelectionSummary(elements, session);
  });
  elements.printSelectedButton.addEventListener("click", () =>
    openPrintPreview(elements, session),
  );
  elements.previewLabels.addEventListener("change", (event) => {
    const index = Number(event.target.dataset.index);
    if (!event.target.matches(".preview-checkbox") || !session.preview[index])
      return;
    session.preview[index].selected = event.target.checked;
    updatePreviewCount(elements, session);
  });
  elements.cancelPrintButton.addEventListener("click", () =>
    elements.printDialog.close(),
  );
  elements.printDialog.addEventListener("cancel", (event) => {
    if (session.printing) event.preventDefault();
  });
  elements.confirmPrintButton.addEventListener("click", () =>
    printPreview(elements, session, log),
  );
  navigator.usb?.addEventListener("disconnect", (event) => {
    if (session.connection?.device !== event.device) return;
    session.connection = null;
    elements.connectionStatus.textContent = "Printer disconnected.";
    elements.connectButton.textContent = "Connect QL-600";
  });

  refreshProductionPlan(elements, session, log);
  connectAndStorePrinter(elements, session, false).catch(() => {
    log("Connect the QL-600 when you are ready to print.");
  });
}

/**
 * Appends operator-facing status using textContent, never HTML from the sheet.
 * @param {HTMLElement} element Scrollable status log.
 * @returns {(message: string) => void} Timestamped logger.
 */
function createLogger(element) {
  return (message) => {
    element.textContent += `[${new Date().toLocaleTimeString()}] ${message}\n`;
    element.scrollTop = element.scrollHeight;
  };
}

/**
 * Reloads the plan atomically; failure clears stale rows and disables printing.
 * @param {Object} elements Page controls.
 * @param {Object} session Page-local rows and connection.
 * @param {Function} log Operator status logger.
 * @returns {Promise<void>}
 */
async function refreshProductionPlan(elements, session, log) {
  session.loading = true;
  session.rows = [];
  renderPlanTable(elements, session);
  showTableMessage(elements.planRows, "Loading production plan...");
  try {
    const query = new URLSearchParams({
      key: new URLSearchParams(location.search).get("key") || "",
    });
    const response = await fetch(`/api/label-print-data?${query}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok)
      throw new Error(`Plan request failed: ${response.status}`);
    const plan = await response.json();
    session.rows = plan.rows.map((row) => ({ ...row, selected: true }));
    renderPlanTable(elements, session);
    if (!session.rows.length)
      showTableMessage(elements.planRows, "No labels in the production plan.");
    log(`Loaded ${session.rows.length} drinks.`);
  } catch (error) {
    console.error(error);
    session.rows = [];
    showTableMessage(
      elements.planRows,
      "Could not load the production plan. Try Reload.",
    );
    log(
      "Could not load the production plan. Check your connection and access, then reload.",
    );
  } finally {
    session.loading = false;
    updateSelectionSummary(elements, session);
  }
}

/**
 * Renders a single loading, empty, or error message across the table.
 * @param {HTMLTableSectionElement} body Table body to replace.
 * @param {string} message Public status message.
 * @returns {void}
 */
function showTableMessage(body, message) {
  const row = document.createElement("tr");
  const cell = row.insertCell();
  cell.colSpan = 5;
  cell.className = "px-6 py-3 text-default";
  cell.textContent = message;
  body.replaceChildren(row);
}

/**
 * Creates rows with DOM APIs so drink names cannot become HTML or attributes.
 * @param {Object} elements Page controls.
 * @param {Object} session Current drink rows and selection.
 * @returns {void}
 */
function renderPlanTable(elements, session) {
  elements.planRows.replaceChildren(
    ...session.rows.map((row, index) => {
      const tr = document.createElement("tr");
      const selectionCell = tr.insertCell();
      selectionCell.className =
        "w-12 border-b border-default py-2.5 pl-6 pr-0 align-middle";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "row-checkbox h-[18px] w-[18px] accent-primary";
      checkbox.dataset.index = index;
      checkbox.checked = row.selected;
      checkbox.setAttribute("aria-label", `Select ${row.drinkName}`);
      selectionCell.append(checkbox);
      [
        row.drinkName,
        row.labels.length,
        row.directLabels,
        row.storageLabels,
      ].forEach((value, column) => {
        const cell = tr.insertCell();
        cell.className =
          "border-b border-default px-2.5 py-2.5 align-middle text-default";
        if (column > 0)
          cell.classList.add("orble-table-number", "whitespace-nowrap");
        cell.textContent = value;
      });
      return tr;
    }),
  );
  updateSelectionSummary(elements, session);
}

/**
 * Derives counts from label arrays and reflects partial selection on the master checkbox.
 * @param {Object} elements Page controls.
 * @param {Object} session Current rows and busy flags.
 * @returns {void}
 */
function updateSelectionSummary(elements, session) {
  const selected = session.rows.filter((row) => row.selected);
  elements.selectedLabelCount.textContent = selected.reduce(
    (sum, row) => sum + row.labels.length,
    0,
  );
  elements.planLabelCount.textContent = session.rows.reduce(
    (sum, row) => sum + row.labels.length,
    0,
  );
  elements.selectEverything.checked =
    selected.length > 0 && selected.length === session.rows.length;
  elements.selectEverything.indeterminate =
    selected.length > 0 && selected.length < session.rows.length;
  elements.selectEverything.disabled = session.loading || session.printing;
  elements.reloadPlanButton.disabled = session.loading || session.printing;
  elements.connectButton.disabled = session.printing;
  elements.printSelectedButton.disabled =
    session.loading || session.printing || !selected.length;
}

/**
 * Snapshots every selected label into a scrollable dialog before any USB write.
 * Individual checkboxes let an operator print a single test from that same data.
 * @param {Object} elements Page controls and native dialog.
 * @param {Object} session Rows to snapshot and preview selection.
 * @returns {void}
 */
function openPrintPreview(elements, session) {
  session.preview = session.rows.flatMap((row, rowIndex) =>
    row.selected
      ? row.labels.map((label) => ({ label, rowIndex, selected: true }))
      : [],
  );
  elements.printStatus.textContent = "";
  elements.previewLabels.replaceChildren(
    ...session.preview.map(({ label }, index) => {
      const item = document.createElement("label");
      item.className = "flex min-w-0 items-center gap-3";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      checkbox.className =
        "preview-checkbox h-[18px] w-[18px] shrink-0 accent-primary";
      checkbox.dataset.index = index;
      checkbox.setAttribute(
        "aria-label",
        `Print label ${index + 1}: ${label.drinkName} ${label.code || "Storage or backup"}`,
      );
      const canvas = document.createElement("canvas");
      canvas.className = "block h-auto min-w-0 w-full border border-default";
      canvas.setAttribute("role", "img");
      canvas.setAttribute(
        "aria-label",
        `${index + 1}. ${label.drinkName}, ${label.code || "Storage or backup"}, EXP ${label.expirationDate}`,
      );
      renderLabel(canvas, label);
      item.append(checkbox, canvas);
      return item;
    }),
  );
  updatePreviewCount(elements, session);
  elements.printDialog.showModal();
}

/**
 * Keeps confirmation aligned with the exact labels checked in the preview.
 * @param {Object} elements Preview controls.
 * @param {Object} session Preview selection and print lock.
 * @returns {void}
 */
function updatePreviewCount(elements, session) {
  const count = session.preview.filter((item) => item.selected).length;
  elements.previewCount.textContent = count;
  elements.confirmPrintButton.disabled = session.printing || !count;
}

/**
 * Claims a printer, with prompting permitted only from a user click.
 * @param {Object} elements Connection status controls.
 * @param {Object} session Stores the claimed USB connection.
 * @param {boolean} allowPrompt Whether the browser may ask for permission.
 * @returns {Promise<void>}
 */
async function connectAndStorePrinter(elements, session, allowPrompt) {
  session.connection = await connectPrinter({ allowPrompt });
  elements.connectionStatus.textContent = "QL-600 connected.";
  elements.connectButton.textContent = "QL-600 Connected";
}

/**
 * Sends only confirmed preview labels, with a cut between drink rows. A failed
 * transfer stops the batch; retries require reopening the preview to avoid duplicates.
 * @param {Object} elements Preview, status, and table controls.
 * @param {Object} session Frozen preview and USB connection.
 * @param {Function} log Operator status logger.
 * @returns {Promise<void>}
 */
async function printPreview(elements, session, log) {
  if (session.printing) return;
  const selected = session.preview.filter((item) => item.selected);
  if (!selected.length) return;
  session.printing = true;
  elements.cancelPrintButton.disabled = true;
  elements.previewLabels.querySelectorAll("input").forEach((input) => {
    input.disabled = true;
  });
  updatePreviewCount(elements, session);
  updateSelectionSummary(elements, session);
  elements.printStatus.textContent = "Sending labels...";
  try {
    if (!session.connection)
      await connectAndStorePrinter(elements, session, true);
    const canvas = document.createElement("canvas");
    const jobs = new Map();
    for (const { rowIndex, label } of selected) {
      if (!jobs.has(rowIndex)) jobs.set(rowIndex, []);
      jobs.get(rowIndex).push(label);
    }
    for (const labels of jobs.values()) {
      await transferToPrinter(
        session.connection,
        makeRasterBytes(canvas, labels),
      );
    }
    log(`Sent ${selected.length} labels to the printer.`);
    elements.printDialog.close();
  } catch (error) {
    console.error(error);
    session.connection = null;
    elements.connectionStatus.textContent = "Check the printer connection.";
    elements.connectButton.textContent = "Connect QL-600";
    elements.printStatus.textContent =
      "Printing stopped. Check the printer and which labels printed before retrying.";
    log(elements.printStatus.textContent);
  } finally {
    session.preview = [];
    session.printing = false;
    elements.cancelPrintButton.disabled = false;
    elements.confirmPrintButton.disabled = true;
    updateSelectionSummary(elements, session);
  }
}
