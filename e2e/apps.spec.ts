import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ request }) => {
  await request.post("http://localhost:8787/api/scenario/reset", {
    headers: { "X-Session-Id": "seigyo-demo-operator", Origin: "http://localhost:5173" },
    data: { scenario: "checkout-regression", confirmation: "RESET SIMULATION" }
  });
});

test("customer failure, controlled recovery, and successful checkout", async ({ page }) => {
  await page.goto("http://localhost:5174/");
  await expect(page.getByRole("heading", { name: /Objects that hold/ })).toBeVisible();
  await page.getByRole("link", { name: "Kuro lounge chair" }).first().click();
  await page.getByRole("button", { name: /Add to bag/ }).click();
  await page.getByRole("link", { name: /Checkout/ }).click();
  await page.getByRole("button", { name: /Place simulated order/ }).click();
  await expect(page.getByRole("alert")).toContainText("Your bag is safe");

  await page.goto("http://localhost:5173/incidents/INC-042");
  await expect(page.getByRole("heading", { name: "Checkout errors after deployment" })).toBeVisible();
  await page.getByRole("button", { name: "Investigate" }).click();
  await expect(page.getByText("Leading hypotheses")).toBeVisible();
  await page.getByRole("button", { name: "Propose action" }).click();
  await page.getByRole("button", { name: "Approve exact action" }).click();
  await page.getByRole("button", { name: "Execute approved action" }).click();
  await page.getByRole("button", { name: "Verify outcome" }).click();
  await expect(page.getByText(/Observed outcome: recovered/)).toBeVisible();

  await page.goto("http://localhost:5174/checkout");
  await page.getByRole("button", { name: /Place simulated order/ }).click();
  await expect(page.getByRole("heading", { name: /Thank you/ })).toBeVisible();
  await expect(page.getByText(/Order confirmed/).first()).toBeVisible();
});

test("primary pages have no serious automated accessibility violations", async ({ page }) => {
  for (const url of ["http://localhost:5173/", "http://localhost:5173/incidents", "http://localhost:5174/", "http://localhost:5174/collections/all"]) {
    await page.goto(url);
    await expect(page.locator("main")).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter(item => ["critical", "serious"].includes(item.impact ?? "")), url).toEqual([]);
  }
});
