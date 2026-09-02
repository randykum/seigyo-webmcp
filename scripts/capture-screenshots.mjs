import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

for (const [url, path, fullPage] of [
  ["http://localhost:5173/", "screenshots/seigyo-overview.png", true],
  ["http://localhost:5173/incidents/INC-042", "screenshots/seigyo-incident.png", false],
  ["http://localhost:5173/services", "screenshots/seigyo-services.png", true],
  ["http://localhost:5174/", "screenshots/myshop-home.png", true],
]) {
  await desktop.goto(url, { waitUntil: "networkidle" });
  await desktop.locator("main").waitFor();
  await desktop.screenshot({ path, fullPage });
}

await fetch("http://localhost:8787/api/store/carts/myshop-judging-cart/items", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ productId: "PRD-001", quantity: 1 })
});
await desktop.goto("http://localhost:5174/checkout", { waitUntil: "networkidle" });
await desktop.locator("main").waitFor();
await desktop.screenshot({ path: "screenshots/myshop-checkout.png", fullPage: true });

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await mobile.goto("http://localhost:5174/", { waitUntil: "networkidle" });
await mobile.locator("main").waitFor();
await mobile.screenshot({ path: "screenshots/myshop-mobile.png", fullPage: true });
await mobile.goto("http://localhost:5173/services", { waitUntil: "networkidle" });
await mobile.locator("main").waitFor();
await mobile.screenshot({ path: "screenshots/seigyo-services-mobile.png", fullPage: true });

await browser.close();
