import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const essentialTextSelectors = [
  "button", "nav a", "label", "th", "td", ".status", ".eyebrow", ".log-row", ".dependency-node", ".provider-mark", ".service-row",
  ".notice-bar", ".product-meta", ".collection-tools", ".product-info", ".checkout-form", ".order-summary", "footer"
].join(",");

async function textBelowMinimum(page: import("@playwright/test").Page) {
  return page.locator(essentialTextSelectors).evaluateAll(elements => elements.flatMap(element => {
    const style = getComputedStyle(element);
    const text = element.textContent?.trim() ?? "";
    if (!text || style.display === "none" || style.visibility === "hidden") return [];
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return [];
    const size = Number.parseFloat(style.fontSize);
    return size < 11 ? [{ tag: element.tagName, className: element.className, text: text.slice(0, 60), size }] : [];
  }));
}

test.beforeEach(async ({ request }) => {
  await request.post("http://localhost:8787/api/scenario/reset", {
    headers: { "X-Session-Id": "seigyo-operator-session", Origin: "http://localhost:5173" },
    data: { scenario: "checkout-regression", confirmation: "RESET ENVIRONMENT" }
  });
});

test("customer failure, controlled recovery, and successful checkout", async ({ page }) => {
  await page.goto("http://localhost:5174/");
  await expect(page.getByRole("heading", { name: /Objects that hold/ })).toBeVisible();
  await page.getByRole("link", { name: "Kuro lounge chair" }).first().click();
  await page.getByRole("button", { name: /Add to bag/ }).click();
  await page.getByRole("link", { name: /Checkout/ }).click();
  await page.getByRole("button", { name: /Place order/ }).click();
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
  await page.getByRole("button", { name: /Place order/ }).click();
  await expect(page.getByRole("heading", { name: /Thank you/ })).toBeVisible();
  await expect(page.getByText(/Order confirmed/).first()).toBeVisible();
});

test("primary pages have no serious automated accessibility violations", async ({ page }) => {
  for (const url of [
    "http://localhost:5173/", "http://localhost:5173/incidents", "http://localhost:5173/incidents/INC-042", "http://localhost:5173/services", "http://localhost:5173/deployments", "http://localhost:5173/evidence", "http://localhost:5173/runbooks", "http://localhost:5173/receipts", "http://localhost:5173/settings",
    "http://localhost:5174/", "http://localhost:5174/collections/all", "http://localhost:5174/product/kuro-lounge-chair", "http://localhost:5174/search", "http://localhost:5174/cart", "http://localhost:5174/order", "http://localhost:5174/about"
  ]) {
    await page.goto(url);
    const retry = page.getByRole("button", { name: "Try again" });
    if (await retry.isVisible().catch(() => false)) await retry.click();
    await expect(page.locator("main"), url).toBeVisible({ timeout: 20_000 });
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter(item => ["critical", "serious"].includes(item.impact ?? "")), url).toEqual([]);
    expect(await textBelowMinimum(page), url).toEqual([]);
  }
});

test("service architecture names every provider and remains readable", async ({ page }) => {
  await page.goto("http://localhost:5173/services");
  await expect(page.getByText("4 providers")).toBeVisible();
  for (const provider of ["Cloudflare", "Render", "Stripe", "Supabase"]) await expect(page.getByText(provider).first()).toBeVisible();
  await expect(page.getByText("catalog-api-prod")).toBeVisible();
  await expect(page.getByText("Frankfurt").first()).toBeVisible();
  expect(await textBelowMinimum(page)).toEqual([]);
});

test("invalid routes and orders show clear not-found states", async ({ page }) => {
  await page.goto("http://localhost:5173/incidents/DOES-NOT-EXIST");
  await expect(page.getByRole("heading", { name: "Incident not found" })).toBeVisible();
  await page.goto("http://localhost:5173/DOES-NOT-EXIST");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.goto("http://localhost:5174/DOES-NOT-EXIST");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.goto("http://localhost:5174/confirmation/ORD-DOES-NOT-EXIST");
  await expect(page.getByRole("heading", { name: "Order not found" })).toBeVisible();
});
