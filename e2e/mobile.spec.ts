import { expect, test } from "@playwright/test";

test("both applications remain usable on a compact viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("http://localhost:5174/");
  await expect(page.getByRole("heading", { name: /Objects that hold/ })).toBeVisible();
  await page.goto("http://localhost:5173/");
  await expect(page.getByRole("heading", { name: "Recovery control" })).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("link", { name: "Incidents" })).toBeVisible();
  await page.goto("http://localhost:5173/services");
  await expect(page.getByText("Cloudflare").first()).toBeVisible();
  await expect(page.getByText("Render").first()).toBeVisible();
});
