import { test, expect } from "@playwright/test";
import { buildLabelPrintData } from "../../../src/lib/label-printer/production-plan.js";

const plan = buildLabelPrintData(
  [
    {
      "Drink Variation": 'Matcha "Less Sugar" 16oz',
      "Amount to Make": 2,
      "Amount to 30TH": 1,
      "Slot (30TH)": "1, 2",
    },
    {
      "Drink Variation": "Strawberry Matcha 24oz with Lychee",
      "Amount to Make": 1,
      "Amount to Towne": 1,
      "Slot (Towne)": "14, 15",
    },
  ],
  { now: new Date("2026-10-26T12:00:00Z") },
);

test.beforeEach(async ({ page }) => {
  await page.route("**/api/label-print-data?*", (route) =>
    route.fulfill({ json: plan }),
  );
  await page.addInitScript(() => {
    window.usbWrites = [];
    window.usbPrompts = 0;
    window.failTransfer = false;
    const usb = new EventTarget();
    const device = {
      vendorId: 0x04f9,
      productId: 0x20c0,
      opened: false,
      configuration: {
        interfaces: [
          {
            interfaceNumber: 0,
            alternate: {
              endpoints: [
                { direction: "out", type: "bulk", endpointNumber: 1 },
              ],
            },
          },
        ],
      },
      open: async () => {
        device.opened = true;
      },
      claimInterface: async () => {},
      transferOut: async (endpoint, bytes) => {
        window.usbWrites.push(Array.from(bytes));
        return {
          status: window.failTransfer ? "stall" : "ok",
          bytesWritten: bytes.byteLength,
        };
      },
    };
    usb.getDevices = async () => [];
    usb.requestDevice = async () => {
      window.usbPrompts += 1;
      return device;
    };
    Object.defineProperty(navigator, "usb", { value: usb, configurable: true });
  });
  await page.goto("/label-printer?key=test-key");
  await expect(page.locator(".row-checkbox")).toHaveCount(2);
});

test("previews every label with full slot codes before permission or USB writes", async ({
  page,
}, testInfo) => {
  await expect(page.locator("#selectedLabelCount")).toHaveText("5");
  await page.getByRole("button", { name: "Print Selected" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("#previewLabels canvas")).toHaveCount(5);
  await expect(page.locator("#previewLabels canvas").first()).toHaveAttribute(
    "aria-label",
    /30TH#1,2/,
  );
  await expect(page.locator("#previewLabels canvas").nth(3)).toHaveAttribute(
    "aria-label",
    /TWNE#14,15/,
  );
  expect(await page.evaluate(() => window.usbPrompts)).toBe(0);
  expect(await page.evaluate(() => window.usbWrites.length)).toBe(0);
  const ink = await page
    .locator("#previewLabels canvas")
    .evaluateAll((canvases) =>
      canvases.map((canvas) => {
        const pixels = canvas
          .getContext("2d")
          .getImageData(0, 0, canvas.width, canvas.height).data;
        return pixels.some((value, index) => index % 4 === 0 && value < 100);
      }),
    );
  expect(ink.every(Boolean)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("preview.png") });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await page.evaluate(() => window.usbWrites.length)).toBe(0);
});

test("prints one checked label from the preview", async ({ page }) => {
  await page.getByRole("button", { name: "Print Selected" }).click();
  const checkboxes = page.locator(".preview-checkbox");
  for (let i = 1; i < 5; i++) await checkboxes.nth(i).uncheck();
  await expect(page.locator("#previewCount")).toHaveText("1");
  await page.getByRole("button", { name: "Print Labels", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(await page.evaluate(() => window.usbWrites.length)).toBe(1);
  expect(await page.evaluate(() => window.usbPrompts)).toBe(1);
  await expect(page.locator("#log")).toContainText("Sent 1 labels");
});

test("selection controls totals and each drink becomes one USB cut job", async ({
  page,
}) => {
  await page.locator(".row-checkbox").last().uncheck();
  await expect(page.locator("#selectedLabelCount")).toHaveText("3");
  await expect(page.locator("#selectEverything")).toHaveJSProperty(
    "indeterminate",
    true,
  );
  await page.locator("#selectEverything").check();
  await page.getByRole("button", { name: "Print Selected" }).click();
  await page.getByRole("button", { name: "Print Labels", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(await page.evaluate(() => window.usbWrites.length)).toBe(2);
  const endings = await page.evaluate(() =>
    window.usbWrites.map((bytes) => bytes.at(-1)),
  );
  expect(endings).toEqual([0x1a, 0x1a]);
});

test("failed reload clears stale selections and never displays server details", async ({
  page,
}) => {
  await page.route("**/api/label-print-data?*", (route) =>
    route.fulfill({ status: 500, json: { error: "private-server-detail" } }),
  );
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(page.locator("#planRows")).toContainText("Could not load");
  await expect(page.locator("#selectedLabelCount")).toHaveText("0");
  await expect(
    page.getByRole("button", { name: "Print Selected" }),
  ).toBeDisabled();
  await expect(page.locator("body")).not.toContainText("private-server-detail");
});

test("USB failure stops later drinks and prevents an accidental retry", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.failTransfer = true;
  });
  await page.getByRole("button", { name: "Print Selected" }).click();
  await page.getByRole("button", { name: "Print Labels", exact: true }).click();
  await expect(page.locator("#printStatus")).toContainText("Printing stopped");
  expect(await page.evaluate(() => window.usbWrites.length)).toBe(1);
  await expect(
    page.getByRole("button", { name: "Print Labels", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeEnabled();
});
