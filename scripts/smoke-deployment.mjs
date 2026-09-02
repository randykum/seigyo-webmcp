import { chromium } from "@playwright/test";

const seigyoUrl = process.env.SEIGYO_URL;
const myshopUrl = process.env.MYSHOP_URL;
const apiUrl = process.env.API_URL;

if (!seigyoUrl || !myshopUrl || !apiUrl) {
  throw new Error("SEIGYO_URL, MYSHOP_URL, and API_URL are required");
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const resetScenario = async () => {
  const response = await fetch(`${apiUrl}/api/scenario/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Session-Id": "seigyo-demo-operator", Origin: seigyoUrl },
    body: JSON.stringify({ scenario: "checkout-regression", confirmation: "RESET SIMULATION" }),
  });
  if (!response.ok) throw new Error(`Scenario reset failed with ${response.status}`);
};

await resetScenario();

await page.goto(seigyoUrl, { waitUntil: "networkidle" });
await page.getByRole("heading", { name: "Recovery control" }).waitFor();
const snapshot = await page.evaluate(async apiBase => {
  const response = await fetch(`${apiBase}/api/snapshot`, { headers: { "X-Session-Id": "seigyo-demo-operator" } });
  return { status: response.status, cors: response.headers.get("access-control-allow-origin"), body: await response.json() };
}, apiUrl);
if (snapshot.status !== 200 || !snapshot.body.ok) {
  throw new Error(`Seigyo API smoke test failed: ${JSON.stringify(snapshot)}`);
}
await page.screenshot({ path: "screenshots/deployed-seigyo.png", fullPage: false });

await page.goto(myshopUrl, { waitUntil: "networkidle" });
await page.getByRole("heading", { name: "Objects that hold the room quietly." }).waitFor();
const health = await page.evaluate(async apiBase => {
  const response = await fetch(`${apiBase}/api/store/health`);
  return { status: response.status, cors: response.headers.get("access-control-allow-origin"), body: await response.json() };
}, apiUrl);
if (health.status !== 200 || !health.body.ok) {
  throw new Error(`MyShop API smoke test failed: ${JSON.stringify(health)}`);
}
await page.screenshot({ path: "screenshots/deployed-myshop.png", fullPage: false });

await page.getByRole("link", { name: "Kuro lounge chair" }).first().click();
await page.getByRole("button", { name: /Add to bag/ }).click();
await page.getByRole("link", { name: /Checkout/ }).click();
await page.getByRole("button", { name: /Place simulated order/ }).click();
await page.getByRole("alert").waitFor();

await page.goto(`${seigyoUrl}/incidents/INC-042`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Investigate" }).click();
await page.getByText("Leading hypotheses").waitFor();
await page.getByRole("button", { name: "Propose action" }).click();
await page.getByRole("button", { name: "Approve exact action" }).click();
await page.getByRole("button", { name: "Execute approved action" }).click();
await page.getByRole("button", { name: "Verify outcome" }).click();
await page.getByText(/Observed outcome: recovered/).waitFor();

await page.goto(`${myshopUrl}/checkout`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Place simulated order/ }).click();
await page.getByRole("heading", { name: /Thank you/ }).waitFor();

await browser.close();

for (const origin of [seigyoUrl, myshopUrl]) {
  const response = await fetch(`${apiUrl}/api/snapshot`, { headers: { Origin: origin } });
  if (response.headers.get("access-control-allow-origin") !== origin) {
    throw new Error(`Exact-origin CORS smoke test failed for ${origin}`);
  }
}

await resetScenario();

console.log(JSON.stringify({ seigyo: snapshot.status, myshop: health.status, recovery: "verified", stateVersion: snapshot.body.stateVersion }));
