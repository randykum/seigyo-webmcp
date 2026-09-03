import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const essentialTextSelectors = [
  "button",
  "nav a",
  "label",
  "th",
  "td",
  ".status",
  ".eyebrow",
  ".log-row",
  ".dependency-node",
  ".provider-mark",
  ".service-row",
  ".notice-bar",
  ".product-meta",
  ".collection-tools",
  ".product-info",
  ".checkout-form",
  ".order-summary",
  "footer",
].join(",");

const E2E_SESSION = "e2e-judge-session";
const scoped = (url: string) =>
  `${url}${url.includes("?") ? "&" : "?"}session=${E2E_SESSION}`;

async function textBelowMinimum(page: import("@playwright/test").Page) {
  return page.locator(essentialTextSelectors).evaluateAll((elements) =>
    elements.flatMap((element) => {
      const style = getComputedStyle(element);
      const text = element.textContent?.trim() ?? "";
      if (!text || style.display === "none" || style.visibility === "hidden")
        return [];
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return [];
      const size = Number.parseFloat(style.fontSize);
      return size < 11
        ? [
            {
              tag: element.tagName,
              className: element.className,
              text: text.slice(0, 60),
              size,
            },
          ]
        : [];
    }),
  );
}

test.beforeEach(async ({ request }) => {
  await request.post("http://localhost:8787/api/scenario/reset", {
    headers: {
      "X-Session-Id": E2E_SESSION,
      Origin: "http://localhost:5173",
    },
    data: {
      scenario: "checkout-regression",
      confirmation: "RESET ENVIRONMENT",
    },
  });
});

test("customer failure, controlled recovery, and successful checkout", async ({
  page,
  context,
}) => {
  await page.goto(scoped("http://localhost:5174/"));
  await expect(
    page.getByRole("heading", { name: /Objects that hold/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Kuro lounge chair" }).first().click();
  await page.getByRole("button", { name: /Add to bag/ }).click();
  await page.getByRole("link", { name: /Checkout/ }).click();
  await page.getByRole("button", { name: /Place order/ }).click();
  await expect(page.getByRole("alert")).toContainText("Your bag is safe");

  await page.addInitScript(() => {
    const tools: Record<
      string,
      { execute(input: unknown): Promise<{ structuredContent: unknown }> }
    > = {};
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: {
          name: string;
          execute(input: unknown): Promise<{ structuredContent: unknown }>;
        }) {
          tools[tool.name] = tool;
          Object.assign(globalThis, { __seigyoTools: tools });
        },
      },
    });
  });
  await page.goto(scoped("http://localhost:5173/incidents/INC-042"));
  await expect(
    page.getByRole("heading", { name: "Checkout errors after deployment" }),
  ).toBeVisible();
  const investigation = await page.evaluate(async () => {
    const tools = (
      globalThis as typeof globalThis & {
        __seigyoTools: Record<
          string,
          { execute(input: unknown): Promise<{ structuredContent: unknown }> }
        >;
      }
    ).__seigyoTools;
    return tools["seigyo.investigate_incident"]?.execute({
      incidentId: "INC-042",
    });
  });
  expect(investigation?.structuredContent).toBeTruthy();
  await page.evaluate(() => {
    const context = globalThis as typeof globalThis & {
      __seigyoTools: Record<
        string,
        { execute(input: unknown): Promise<{ structuredContent: unknown }> }
      >;
      __pendingProposal?: Promise<{ structuredContent: unknown }>;
    };
    context.__pendingProposal = context.__seigyoTools[
      "seigyo.propose_action"
    ]?.execute({
      incidentId: "INC-042",
      action: {
        type: "rollback_deployment",
        targetService: "checkout-api",
        parameters: {},
      },
      rationale: "The checkout error increase follows the current deployment.",
      evidenceRefs: ["deployment:DEP-160"],
      idempotencyKey: "e2e-proposal-rollback-001",
    });
  });
  await expect(
    page.getByRole("alertdialog", { name: "Approve exact intervention" }),
  ).toBeVisible();
  const approveButton = page.getByRole("button", {
    name: "Approve exact action",
  });
  const rejectButton = page.getByRole("button", { name: "Reject" });
  await expect(approveButton).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(rejectButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(approveButton).toBeFocused();
  const approvalA11y = await new AxeBuilder({ page }).analyze();
  expect(
    approvalA11y.violations.filter((item) =>
      ["critical", "serious"].includes(item.impact ?? ""),
    ),
  ).toEqual([]);
  await approveButton.click();
  const proposalResult = await page.evaluate(async () => {
    const context = globalThis as typeof globalThis & {
      __pendingProposal?: Promise<{
        structuredContent: {
          proposal: { id: string; incidentId: string };
          decision: string;
        };
      }>;
    };
    return context.__pendingProposal;
  });
  expect(proposalResult?.structuredContent.decision).toBe("approved");
  const proposalId = proposalResult?.structuredContent.proposal.id as string;
  const executionResult = await page.evaluate(
    async ({ proposalId }) => {
      const tools = (
        globalThis as typeof globalThis & {
          __seigyoTools: Record<
            string,
            {
              execute(input: unknown): Promise<{
                structuredContent: { id: string; incidentId: string };
              }>;
            }
          >;
        }
      ).__seigyoTools;
      return tools["seigyo.execute_action"]?.execute({
        proposalId,
        idempotencyKey: "e2e-execution-rollback-001",
      });
    },
    { proposalId },
  );
  const executionId = executionResult?.structuredContent.id as string;
  const verificationResult = await page.evaluate(
    async ({ executionId }) => {
      const tools = (
        globalThis as typeof globalThis & {
          __seigyoTools: Record<
            string,
            {
              execute(
                input: unknown,
              ): Promise<{ structuredContent: { outcome: string } }>;
            }
          >;
        }
      ).__seigyoTools;
      return tools["seigyo.verify_action"]?.execute({
        executionId,
        incidentId: "INC-042",
      });
    },
    { executionId },
  );
  expect(verificationResult?.structuredContent.outcome).toBe("recovered");
  await page.goto(scoped("http://localhost:5173/incidents"));
  await expect(page.getByRole("tab", { name: /Active 0/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator('nav a[href="/incidents"] b')).toHaveCount(0);
  await page.getByRole("tab", { name: /History/ }).click();
  await expect(page.getByText("INC-042")).toBeVisible();

  await page.goto(scoped("http://localhost:5173/"));
  await expect(page.locator(".status-strip-operational")).toBeVisible();
  await expect(page.locator(".status-strip-operational")).toHaveCSS(
    "box-shadow",
    /rgb\(119, 213, 154\)/,
  );

  await page.goto(scoped("http://localhost:5174/checkout"));
  await page.getByRole("button", { name: /Place order/ }).click();
  await expect(page.getByRole("heading", { name: /Thank you/ })).toBeVisible();
  await expect(page.getByText(/Order confirmed/).first()).toBeVisible();

  const operationsPage = await context.newPage();
  await operationsPage.goto(scoped("http://localhost:5173/settings"));
  await expect(
    operationsPage.getByRole("link", { name: "Open storefront" }),
  ).toHaveAttribute("href", /session=e2e-judge-session/);
  const deployButton = operationsPage.getByRole("button", {
    name: "Deploy new revision",
  });
  await expect(deployButton).toBeEnabled();
  await deployButton.click();
  await expect(
    operationsPage.getByText("Checkout revision deployed"),
  ).toBeVisible();
  await expect(deployButton).toBeDisabled();
  await expect(page.locator(".service-note")).toContainText(
    "Checkout is currently unavailable",
  );
  await operationsPage.goto(scoped("http://localhost:5173/"));
  await expect(operationsPage.locator(".status-strip-investigating")).toHaveCSS(
    "box-shadow",
    /rgb\(241, 192, 106\)/,
  );
  await operationsPage.close();
});

test("incident navigation and measured topology remain correct across widths", async ({
  page,
}) => {
  for (const width of [320, 390, 768, 1186, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(scoped("http://localhost:5173/services"));
    await expect(page.locator(".dependency-edge")).toHaveCount(9);
    const errors = await page.locator(".dependency-map").evaluate((map) => {
      const mapRect = map.getBoundingClientRect();
      return [...map.querySelectorAll<SVGGElement>(".dependency-edge")].flatMap(
        (edge) => {
          const from = edge.dataset.edgeFrom;
          const to = edge.dataset.edgeTo;
          const source = map
            .querySelector<HTMLElement>(`[data-service-id="${from}"]`)
            ?.getBoundingClientRect();
          const target = map
            .querySelector<HTMLElement>(`[data-service-id="${to}"]`)
            ?.getBoundingClientRect();
          const circles = edge.querySelectorAll<SVGCircleElement>("circle");
          if (!source || !target || circles.length !== 2)
            return [{ from, to, reason: "missing geometry" }];
          const expected = [
            source.right - mapRect.left,
            source.top + source.height / 2 - mapRect.top,
            target.left - mapRect.left,
            target.top + target.height / 2 - mapRect.top,
          ];
          const actual = [
            Number(circles[0]?.getAttribute("cx")),
            Number(circles[0]?.getAttribute("cy")),
            Number(circles[1]?.getAttribute("cx")),
            Number(circles[1]?.getAttribute("cy")),
          ];
          return actual.some(
            (value, index) => Math.abs(value - (expected[index] ?? value)) > 2,
          )
            ? [{ from, to, expected, actual }]
            : [];
        },
      );
    });
    expect(errors, `${width}px topology`).toEqual([]);
  }
  await page.goto(scoped("http://localhost:5173/incidents/INC-042"));
  await expect(
    page.getByRole("link", { name: "Back to incidents" }),
  ).toHaveAttribute("href", "/incidents");
  await page.getByRole("link", { name: "Back to incidents" }).click();
  await expect(page).toHaveURL("http://localhost:5173/incidents");
});

test("primary pages have no serious automated accessibility violations", async ({
  page,
}) => {
  for (const url of [
    scoped("http://localhost:5173/"),
    scoped("http://localhost:5173/incidents"),
    scoped("http://localhost:5173/incidents/INC-042"),
    scoped("http://localhost:5173/services"),
    scoped("http://localhost:5173/deployments"),
    scoped("http://localhost:5173/evidence"),
    scoped("http://localhost:5173/runbooks"),
    scoped("http://localhost:5173/receipts"),
    scoped("http://localhost:5173/settings"),
    scoped("http://localhost:5174/"),
    scoped("http://localhost:5174/collections/all"),
    scoped("http://localhost:5174/product/kuro-lounge-chair"),
    scoped("http://localhost:5174/search"),
    scoped("http://localhost:5174/cart"),
    scoped("http://localhost:5174/order"),
    scoped("http://localhost:5174/about"),
  ]) {
    await page.goto(url);
    const retry = page.getByRole("button", { name: "Try again" });
    if (await retry.isVisible().catch(() => false)) await retry.click();
    await expect(page.locator("main"), url).toBeVisible({ timeout: 20_000 });
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter((item) =>
        ["critical", "serious"].includes(item.impact ?? ""),
      ),
      url,
    ).toEqual([]);
    expect(await textBelowMinimum(page), url).toEqual([]);
  }
});

test("service architecture names every provider and remains readable", async ({
  page,
}) => {
  await page.goto(scoped("http://localhost:5173/services"));
  await expect(page.getByText("4 providers")).toBeVisible();
  for (const provider of ["Cloudflare", "Render", "Stripe", "Supabase"])
    await expect(page.getByText(provider).first()).toBeVisible();
  await expect(page.getByText("catalog-api-prod")).toBeVisible();
  await expect(page.getByText("Frankfurt").first()).toBeVisible();
  expect(await textBelowMinimum(page)).toEqual([]);
});

test("fresh browser sessions receive distinct keys and carts", async ({
  browser,
}) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  await firstContext.addInitScript(() => {
    const tools: Record<string, { inputSchema?: unknown }> = {};
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: { name: string; inputSchema?: unknown }) {
          tools[tool.name] = tool;
          Object.assign(globalThis, { __myshopTools: tools });
        },
      },
    });
  });
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();
  await firstPage.goto("http://localhost:5174/");
  await secondPage.goto("http://localhost:5174/");
  const firstSession = await firstPage.evaluate(() =>
    sessionStorage.getItem("myshop.seigyo-session"),
  );
  const secondSession = await secondPage.evaluate(() =>
    sessionStorage.getItem("myshop.seigyo-session"),
  );
  expect(firstSession).toMatch(/^judge-[a-f0-9]{32}$/);
  expect(secondSession).toMatch(/^judge-[a-f0-9]{32}$/);
  expect(firstSession).not.toBe(secondSession);
  const schemas = await firstPage.evaluate(() => {
    const tools = (
      globalThis as typeof globalThis & {
        __myshopTools: Record<
          string,
          { inputSchema?: { properties?: Record<string, unknown> } }
        >;
      }
    ).__myshopTools;
    return {
      cartId: tools["myshop.get_cart"]?.inputSchema?.properties?.cartId,
      slug: tools["myshop.get_product"]?.inputSchema?.properties?.slug,
      orderId: tools["myshop.get_order"]?.inputSchema?.properties?.orderId,
    };
  });
  expect(schemas.cartId).toMatchObject({ maxLength: 80 });
  expect(schemas.slug).toMatchObject({ maxLength: 80 });
  expect(schemas.orderId).toMatchObject({ maxLength: 80 });

  await firstPage.getByRole("link", { name: "Kuro lounge chair" }).first().click();
  await firstPage.getByRole("button", { name: /Add to bag/ }).click();
  await expect(
    firstPage.getByRole("button", { name: "Open bag with 1 items" }),
  ).toBeVisible();
  await expect(
    secondPage.getByRole("button", { name: "Open bag with 0 items" }),
  ).toBeVisible();
  await firstContext.close();
  await secondContext.close();
});

test("invalid routes and orders show clear not-found states", async ({
  page,
}) => {
  await page.goto(scoped("http://localhost:5173/incidents/DOES-NOT-EXIST"));
  await expect(
    page.getByRole("heading", { name: "Incident not found" }),
  ).toBeVisible();
  await page.goto(scoped("http://localhost:5173/DOES-NOT-EXIST"));
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible();
  await page.goto(scoped("http://localhost:5174/DOES-NOT-EXIST"));
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible();
  await page.goto(scoped("http://localhost:5174/confirmation/ORD-DOES-NOT-EXIST"));
  await expect(
    page.getByRole("heading", { name: "Order not found" }),
  ).toBeVisible();
});
