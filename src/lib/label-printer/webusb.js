import { QL600_PRODUCT_ID, USB_VENDOR_ID } from "./raster.js";

export async function connectPrinter({ allowPrompt = false } = {}) {
  if (!("usb" in navigator)) {
    throw new Error("WebUSB is not available. Use Chrome or Edge over HTTPS.");
  }

  const device = allowPrompt ? await requestPrinterPermission() : await findAllowedPrinter();
  if (!device) {
    throw new Error("Printer permission is needed. Choose the QL-600 to continue.");
  }

  return preparePrinterDevice(device);
}

export async function transferToPrinter(connection, payload) {
  if (!connection?.device || connection.endpointNumber == null) {
    throw new Error("Printer is not connected.");
  }
  return connection.device.transferOut(connection.endpointNumber, payload);
}

async function findAllowedPrinter() {
  const devices = await navigator.usb.getDevices();
  return (
    devices.find(
      (device) =>
        device.vendorId === USB_VENDOR_ID && device.productId === QL600_PRODUCT_ID,
    ) || null
  );
}

async function requestPrinterPermission() {
  return navigator.usb.requestDevice({
    filters: [{ vendorId: USB_VENDOR_ID, productId: QL600_PRODUCT_ID }],
  });
}

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

function findPrinterEndpoint(device) {
  for (const configuration of device.configurations) {
    for (const iface of configuration.interfaces) {
      for (const alternate of iface.alternates) {
        const outEndpoint = alternate.endpoints.find(
          (endpoint) => endpoint.direction === "out",
        );
        if (outEndpoint && (alternate.interfaceClass === 7 || device.vendorId === USB_VENDOR_ID)) {
          return {
            interfaceNumber: iface.interfaceNumber,
            endpointNumber: outEndpoint.endpointNumber,
          };
        }
      }
    }
  }
  throw new Error("Could not find a printer OUT endpoint on this USB device.");
}
