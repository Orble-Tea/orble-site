const BROTHER_VENDOR_ID = 0x04f9;
const QL600_PRODUCT_ID = 0x20c0;

/**
 * Opens an authorized QL-600 or requests access during an operator click.
 * @param {{allowPrompt?: boolean}} options Whether a permission picker is allowed.
 * @returns {Promise<Object>} Claimed device and output endpoint.
 */
export async function connectPrinter({ allowPrompt = false } = {}) {
  if (!("usb" in navigator)) {
    throw new Error("WebUSB is not available. Use Chrome or Edge over HTTPS.");
  }

  const device = allowPrompt
    ? await requestPrinterPermission()
    : await findAllowedPrinter();
  if (!device) {
    throw new Error(
      "Printer permission is needed. Choose the QL-600 to continue.",
    );
  }

  return preparePrinterDevice(device);
}

/**
 * Sends one complete raster job; a USB error must stop subsequent jobs.
 * @param {Object} connection Claimed printer connection.
 * @param {Uint8Array} payload Brother raster commands.
 * @returns {Promise<USBOutTransferResult>} Successful USB transfer result.
 */
export async function transferToPrinter(connection, payload) {
  if (!connection?.device || connection.endpointNumber == null) {
    throw new Error("Printer is not connected.");
  }
  const result = await connection.device.transferOut(
    connection.endpointNumber,
    payload,
  );
  if (result.status !== "ok" || result.bytesWritten !== payload.byteLength) {
    throw new Error("Printer transfer incomplete.");
  }
  return result;
}

/** @returns {Promise<USBDevice|null>} Previously authorized QL-600, if attached. */
async function findAllowedPrinter() {
  const devices = await navigator.usb.getDevices();
  return (
    devices.find(
      (device) =>
        device.vendorId === BROTHER_VENDOR_ID &&
        device.productId === QL600_PRODUCT_ID,
    ) || null
  );
}

/** @returns {Promise<USBDevice>} QL-600 chosen in the browser permission picker. */
async function requestPrinterPermission() {
  return navigator.usb.requestDevice({
    filters: [{ vendorId: BROTHER_VENDOR_ID, productId: QL600_PRODUCT_ID }],
  });
}

/**
 * Opens and claims the active printer interface before sending bytes.
 * @param {USBDevice} device Authorized printer.
 * @returns {Promise<Object>} Device with claimed interface and endpoint numbers.
 */
async function preparePrinterDevice(device) {
  if (!device.opened) {
    await device.open();
  }
  if (device.configuration === null) {
    await device.selectConfiguration(1);
  }

  const endpointInfo = findPrinterEndpoint(device);
  await device.claimInterface(endpointInfo.interfaceNumber);

  return {
    device,
    interfaceNumber: endpointInfo.interfaceNumber,
    endpointNumber: endpointInfo.endpointNumber,
  };
}

/**
 * Finds a bulk OUT endpoint in the selected USB configuration and alternates.
 * @param {USBDevice} device Open printer with a selected configuration.
 * @returns {{interfaceNumber: number, endpointNumber: number}} Raster destination.
 */
function findPrinterEndpoint(device) {
  for (const iface of device.configuration.interfaces) {
    const outEndpoint = iface.alternate.endpoints.find(
      (endpoint) => endpoint.direction === "out" && endpoint.type === "bulk",
    );
    if (outEndpoint) {
      return {
        interfaceNumber: iface.interfaceNumber,
        endpointNumber: outEndpoint.endpointNumber,
      };
    }
  }
  throw new Error("Could not find a printer OUT endpoint on this USB device.");
}
