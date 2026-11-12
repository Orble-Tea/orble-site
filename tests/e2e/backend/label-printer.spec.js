import { test, expect } from "@playwright/test";

test("real label API replaces the table with sheet quantity errors on load", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/label-print-data?key=test-key");
  expect(response.ok()).toBe(true);
  const data = await response.json();
  expect(data.rows[0]).toMatchObject({
    drinkName: "Matcha 16oz Less Sugar w/ Lychee",
    directLabels: 5,
    storageLabels: 0,
    spareLabels: 1,
  });
  expect(data.rows[0].labels.map(({ code }) => code)).toEqual([
    "30TH#1",
    "30TH#1",
    "30TH#1",
    "TWNE#14,15",
    "TWNE#14,15",
    "",
  ]);
  await page.goto("/label-printer?key=test-key");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("table")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Print Selected" }),
  ).toBeDisabled();
  await expect(page.locator("#validationErrors")).toContainText(
    "Amount to Make is 1, but the machine amounts total 5.",
  );
  await expect(page.locator("#printDialog")).not.toBeVisible();
  await expect(page.locator("#previewLabels canvas")).toHaveCount(0);
});
