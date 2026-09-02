import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

for (const [url, path, fullPage] of [
  ["http://localhost:5173/", "screenshots/seigyo-overview.png", true],
  ["http://localhost:5173/incidents/inc-001", "screenshots/seigyo-incident.png", false],
  ["http://localhost:5174/", "screenshots/myshop-home.png", true],
]) {
  await desktop.goto(url, { waitUntil: "networkidle" });
  await desktop.locator("main").waitFor();
  await desktop.screenshot({ path, fullPage });
}

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await mobile.goto("http://localhost:5174/", { waitUntil: "networkidle" });
await mobile.locator("main").waitFor();
await mobile.screenshot({ path: "screenshots/myshop-mobile.png", fullPage: true });

await browser.close();
