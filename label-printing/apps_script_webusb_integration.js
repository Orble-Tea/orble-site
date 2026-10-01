// Requires Script Properties: LABEL_PRINTER_URL and LABEL_PRINTER_KEY.

function getLabelPrinterUrl_() {
  var props = PropertiesService.getScriptProperties();
  var baseUrl = props.getProperty('LABEL_PRINTER_URL');
  var key = props.getProperty('LABEL_PRINTER_KEY');
  if (!baseUrl) throw new Error('Missing Script Property: LABEL_PRINTER_URL');
  if (!key) throw new Error('Missing Script Property: LABEL_PRINTER_KEY');
  return baseUrl + (baseUrl.indexOf('?') === -1 ? '?' : '&') + 'key=' + encodeURIComponent(key);
}

function openLabelPrinter() {
  var url = getLabelPrinterUrl_();
  var escapedUrl = escapeHtml_(url);
  var scriptUrl = JSON.stringify(url);
  var html = HtmlService.createHtmlOutput(
    '<link href="https://fonts.googleapis.com/css2?family=Staatliches&display=swap" rel="stylesheet">' +
    '<div style="font-family: Staatliches, sans-serif; text-align: center; padding: 15px; height: 100%; box-sizing: border-box; overflow: hidden;">' +
    '<p style="font-size: 22px; margin: 8px 0;">Print labels</p>' +
    '<a href="' + escapedUrl + '" target="_blank" rel="noopener" style="font-size: 18px; text-decoration: underline;">Open Label Printer</a>' +
    '<script>window.open(' + scriptUrl + ', "_blank", "noopener");</script>' +
    '</div>'
  ).setWidth(350).setHeight(170);
  SpreadsheetApp.getUi().showModalDialog(html, 'Label Printer');
}

function labelPrinterLinkHtml_() {
  var url = getLabelPrinterUrl_();
  return '<p style="font-size: 15px; margin: 10px 0 0;">' +
    '<a href="' + escapeHtml_(url) + '" target="_blank" rel="noopener" style="text-decoration: underline;">Print Labels</a>' +
    '</p>';
}

function escapeHtml_(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
