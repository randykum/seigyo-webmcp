import { chromium } from "@playwright/test";
import { randomUUID } from "node:crypto";

const seigyoUrl = process.env.SEIGYO_URL;
const myshopUrl = process.env.MYSHOP_URL;
const apiUrl = process.env.API_URL;

if (!seigyoUrl || !myshopUrl || !apiUrl) {
  throw new Error("SEIGYO_URL, MYSHOP_URL, and API_URL are required");
}

const sessionId = process.env.SMOKE_SESSION_ID ?? `judge-${randomUUID().replaceAll("-", "")}`;
const directSession = process.env.SMOKE_DIRECT_SESSION === "true";
const scoped = (url) => directSession
  ? url
  : `${url}${url.includes("?") ? "&" : "?"}session=${sessionId}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.addInitScript(() => {
  const tools = {};
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: {
      registerTool(tool) {
        tools[tool.name] = tool;
        globalThis.__seigyoTools = tools;
      },
    },
  });
});

const resetScenario = async () => {
  const response = await fetch(`${apiUrl}/api/scenario/reset`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Session-Id": sessionId,
      Origin: seigyoUrl,
    },
    body: JSON.stringify({
      scenario: "checkout-regression",
      confirmation: "RESET ENVIRONMENT",
    }),
  });
  if (!response.ok)
    throw new Error(`Scenario reset failed with ${response.status}`);
};

await resetScenario();

await page.goto(scoped(seigyoUrl), { waitUntil: "networkidle" });
await page.getByRole("heading", { name: "Operations overview" }).waitFor();
const snapshot = await page.evaluate(async ({ apiBase, sessionId }) => {
  const response = await fetch(`${apiBase}/api/snapshot`, {
    headers: { "X-Session-Id": sessionId },
  });
  return {
    status: response.status,
    cors: response.headers.get("access-control-allow-origin"),
    body: await response.json(),
  };
}, { apiBase: apiUrl, sessionId });
if (snapshot.status !== 200 || !snapshot.body.ok) {
  throw new Error(`Seigyo API smoke test failed: ${JSON.stringify(snapshot)}`);
}
if (
  snapshot.body.data.dependencyEdges.length !== 9 ||
  !snapshot.body.data.operationalStatus
) {
  throw new Error(
    "Seigyo snapshot is missing canonical topology or operational status data",
  );
}
await page.screenshot({
  path: "screenshots/deployed-seigyo.png",
  fullPage: false,
});

await page.goto(scoped(myshopUrl), { waitUntil: "domcontentloaded" });
await page
  .getByRole("heading", { name: "Objects that hold the room quietly." })
  .waitFor();
await page.locator(".hero img").evaluate(async (image) => {
  if (!image.naturalWidth) {
    await new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", reject, { once: true });
    });
  }
  if (!image.naturalWidth) throw new Error("MyShop hero image did not load");
});
const health = await page.evaluate(async ({ apiBase, sessionId }) => {
  const response = await fetch(`${apiBase}/api/store/health`, {
    headers: { "X-Session-Id": sessionId },
  });
  return {
    status: response.status,
    cors: response.headers.get("access-control-allow-origin"),
    body: await response.json(),
  };
}, { apiBase: apiUrl, sessionId });
if (health.status !== 200 || !health.body.ok) {
  throw new Error(`MyShop API smoke test failed: ${JSON.stringify(health)}`);
}
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({
  path: "screenshots/deployed-myshop.png",
  fullPage: false,
});

await page.getByRole("link", { name: "Kuro lounge chair" }).first().click();
await page.getByRole("button", { name: /Add to bag/ }).click();
await page.getByRole("link", { name: /Checkout/ }).click();
await page.getByRole("button", { name: /Place order/ }).click();
await page.getByRole("alert").waitFor();

await page.goto(scoped(`${seigyoUrl}/incidents/INC-042`), { waitUntil: "networkidle" });
await page.evaluate(async () =>
  globalThis.__seigyoTools["seigyo.investigate_incident"].execute({
    incidentId: "INC-042",
  }),
);
await page.evaluate(() => {
  globalThis.__pendingProposal = globalThis.__seigyoTools[
    "seigyo.propose_action"
  ].execute({
    incidentId: "INC-042",
    action: {
      type: "rollback_deployment",
      targetService: "checkout-api",
      parameters: {},
    },
    rationale: "The checkout error increase follows the current deployment.",
    evidenceRefs: ["deployment:DEP-160"],
    idempotencyKey: "deployed-proposal-rollback-001",
  });
});
await page
  .getByRole("alertdialog", { name: "Approve exact intervention" })
  .waitFor();
await page.getByRole("button", { name: "Approve exact action" }).click();
const proposalResult = await page.evaluate(
  async () => globalThis.__pendingProposal,
);
if (proposalResult.structuredContent.decision !== "approved")
  throw new Error("Pending proposal did not resume after approval");
const proposalId = proposalResult.structuredContent.proposal.id;
const executionResult = await page.evaluate(
  async (proposalId) =>
    globalThis.__seigyoTools["seigyo.execute_action"].execute({
      proposalId,
      idempotencyKey: "deployed-execution-rollback-001",
    }),
  proposalId,
);
const verificationResult = await page.evaluate(
  async (executionId) =>
    globalThis.__seigyoTools["seigyo.verify_action"].execute({
      executionId,
      incidentId: "INC-042",
    }),
  executionResult.structuredContent.id,
);
if (verificationResult.structuredContent.outcome !== "recovered")
  throw new Error("Deployed recovery verification did not recover");
await page.goto(scoped(`${seigyoUrl}/incidents`), { waitUntil: "networkidle" });
await page.getByRole("tab", { name: /Active 0/ }).waitFor();
if (await page.locator('nav a[href="/incidents"] b').count())
  throw new Error("Resolved incident badge remained visible");

await page.goto(scoped(`${myshopUrl}/checkout`), { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: /Place order/ }).click();
await page.getByRole("heading", { name: /Thank you/ }).waitFor();

const operationsPage = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
});
await operationsPage.goto(scoped(`${seigyoUrl}/settings`), {
  waitUntil: "networkidle",
});
const deployButton = operationsPage.getByRole("button", {
  name: "Deploy new revision",
});
if (!(await deployButton.isEnabled()))
  throw new Error("Checkout release control was not available after recovery");
await deployButton.click();
await operationsPage.getByText("Checkout revision deployed").waitFor();
if (await deployButton.isEnabled())
  throw new Error("Checkout release control remained enabled during an incident");
await page
  .locator(".service-note")
  .getByText("Checkout is currently unavailable")
  .waitFor();
await operationsPage.goto(scoped(seigyoUrl), { waitUntil: "networkidle" });
await operationsPage.locator(".status-strip-investigating").waitFor();
await operationsPage.close();

await browser.close();

for (const origin of [seigyoUrl, myshopUrl]) {
  const response = await fetch(`${apiUrl}/api/snapshot`, {
    headers: { Origin: origin, "X-Session-Id": sessionId },
  });
  if (response.headers.get("access-control-allow-origin") !== origin) {
    throw new Error(`Exact-origin CORS smoke test failed for ${origin}`);
  }
}

await resetScenario();

console.log(
  JSON.stringify({
    seigyo: snapshot.status,
    myshop: health.status,
    recovery: "verified",
    checkoutRelease: "verified",
    stateVersion: snapshot.body.stateVersion,
  }),
);
