const ORBLE_PRINT_BRIDGE_URL = 'https://YOUR-TUNNEL-URL/run-everything';
const ORBLE_PRINT_TOKEN = 'CHANGE-ME';

function runEverythingLabels() {
  const response = UrlFetchApp.fetch(ORBLE_PRINT_BRIDGE_URL, {
    method: 'post',
    headers: {
      'X-Orble-Print-Token': ORBLE_PRINT_TOKEN,
    },
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error(`Label printing failed (${status}): ${body}`);
  }

  SpreadsheetApp.getActiveSpreadsheet().toast('Label print job sent.', 'Orble labels', 5);
}

function dryRunEverythingLabels() {
  const response = UrlFetchApp.fetch(`${ORBLE_PRINT_BRIDGE_URL}?dry_run=true`, {
    method: 'post',
    headers: {
      'X-Orble-Print-Token': ORBLE_PRINT_TOKEN,
    },
    muteHttpExceptions: true,
  });

  SpreadsheetApp.getActiveSpreadsheet().toast(response.getContentText(), 'Orble label dry run', 10);
}
