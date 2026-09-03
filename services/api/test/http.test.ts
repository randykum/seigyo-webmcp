import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("HTTP security boundary", () => {
  it("rejects an origin outside the exact allowlist", async () => {
    const response = await SELF.fetch("https://worker.test/api/snapshot", { headers: { Origin: "https://attacker.example" } });
    expect(response.status).toBe(403);
    const body = await response.json() as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });

  it("requires the seeded operator session for approval", async () => {
    const response = await SELF.fetch("https://worker.test/api/proposals/PROP-001/approve", { method: "POST" });
    expect(response.status).toBe(401);
    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });

  it("returns a client error for an invalid service query", async () => {
    const response = await SELF.fetch("https://worker.test/api/metrics?serviceId=unknown");
    expect(response.status).toBe(400);
  });

  it("rejects invalid and unbounded query values", async () => {
    for (const path of ["/api/metrics?limit=-1", "/api/metrics?limit=301", "/api/logs?limit=51", `/api/logs?query=${"x".repeat(101)}`]) {
      const response = await SELF.fetch(`https://worker.test${path}`);
      expect(response.status, path).toBe(400);
      const body = await response.json() as { error: { code: string } };
      expect(body.error.code, path).toBe("INVALID_ARGUMENT");
    }
  });

  it("rejects unbounded public store route keys", async () => {
    const oversized = "x".repeat(81);
    for (const path of [
      `/api/store/products/${oversized}`,
      `/api/store/carts/${oversized}`,
      `/api/store/orders/${oversized}`,
    ]) {
      const response = await SELF.fetch(`https://worker.test${path}`);
      expect(response.status, path).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code, path).toBe("INVALID_ARGUMENT");
    }
  });

  it("rejects an oversized mutating request", async () => {
    const response = await SELF.fetch("https://worker.test/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "70000", "X-Session-Id": "seigyo-operator-session" },
      body: JSON.stringify({ value: "small" })
    });
    expect(response.status).toBe(400);
    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_ARGUMENT");
  });

  it("rejects an oversized body when content length is missing", async () => {
    const response = await SELF.fetch("https://worker.test/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Id": "seigyo-operator-session" },
      body: JSON.stringify({ value: "x".repeat(70_000) })
    });
    expect(response.status).toBe(400);
    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_ARGUMENT");
  });

  it("rejects WebSocket requests without the exact origin and session", async () => {
    const response = await SELF.fetch("https://worker.test/ws", { headers: { Upgrade: "websocket" } });
    expect(response.status).toBe(403);
  });

  it("delivers live state events only to the matching session", async () => {
    const connect = async (session: string) => {
      const response = await SELF.fetch(
        `https://worker.test/ws?session=${session}`,
        {
          headers: {
            Origin: "http://localhost:5173",
            Upgrade: "websocket",
          },
        },
      );
      expect(response.status).toBe(101);
      const socket = response.webSocket;
      expect(socket).toBeDefined();
      socket?.accept();
      const events: Array<{ type?: string; payload?: unknown }> = [];
      socket?.addEventListener("message", (event) => {
        try {
          events.push(JSON.parse(String(event.data)) as { type?: string; payload?: unknown });
        } catch {
          // Ignore malformed messages in the test listener.
        }
      });
      return { socket, events };
    };
    const first = await connect("ws-isolation-a");
    const second = await connect("ws-isolation-b");
    await SELF.fetch("https://worker.test/api/scenario/reset", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Id": "ws-isolation-a",
      },
      body: JSON.stringify({
        scenario: "payment-outage",
        confirmation: "RESET ENVIRONMENT",
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(first.events.some((event) => event.type === "scenario.reset")).toBe(
      true,
    );
    expect(second.events.some((event) => event.type === "scenario.reset")).toBe(
      false,
    );
    first.socket?.close();
    second.socket?.close();
  });

  it("protects and strictly validates checkout revision deployment", async () => {
    const unauthenticated = await SELF.fetch(
      "https://worker.test/api/deployments/checkout/revisions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: "release-http-001" }),
      },
    );
    expect(unauthenticated.status).toBe(401);

    const invalid = await SELF.fetch(
      "https://worker.test/api/deployments/checkout/revisions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Id": "seigyo-operator-session",
        },
        body: JSON.stringify({
          idempotencyKey: "release-http-002",
          serviceId: "catalog-api",
        }),
      },
    );
    expect(invalid.status).toBe(400);
    const invalidBody = (await invalid.json()) as {
      error: { code: string };
    };
    expect(invalidBody.error.code).toBe("INVALID_ARGUMENT");
  });

  it("routes each validated session to an isolated environment", async () => {
    const firstSession = "http-isolation-a";
    const secondSession = "http-isolation-b";
    const reset = (session: string, scenario: string) =>
      SELF.fetch("https://worker.test/api/scenario/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Id": session,
        },
        body: JSON.stringify({
          scenario,
          confirmation: "RESET ENVIRONMENT",
        }),
      });
    await reset(firstSession, "checkout-regression");
    await reset(secondSession, "payment-outage");

    const update = await SELF.fetch(
      "https://worker.test/api/store/carts/isolation-cart/items",
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Id": firstSession,
        },
        body: JSON.stringify({ productId: "PRD-001", quantity: 1 }),
      },
    );
    expect(update.status).toBe(200);

    const first = await SELF.fetch("https://worker.test/api/snapshot", {
      headers: { "X-Session-Id": firstSession },
    });
    const second = await SELF.fetch("https://worker.test/api/snapshot", {
      headers: { "X-Session-Id": secondSession },
    });
    const firstBody = (await first.json()) as {
      ok: boolean;
      data: { scenario: string };
    };
    const secondBody = (await second.json()) as {
      ok: boolean;
      data: { scenario: string };
    };
    expect(firstBody.data.scenario).toBe("checkout-regression");
    expect(secondBody.data.scenario).toBe("payment-outage");

    const firstCart = await SELF.fetch(
      "https://worker.test/api/store/carts/isolation-cart",
      { headers: { "X-Session-Id": firstSession } },
    );
    const secondCart = await SELF.fetch(
      "https://worker.test/api/store/carts/isolation-cart",
      { headers: { "X-Session-Id": secondSession } },
    );
    expect((await firstCart.json() as { data: { items: unknown[] } }).data.items).toHaveLength(1);
    expect((await secondCart.json() as { data: { items: unknown[] } }).data.items).toHaveLength(0);
  });

  it("rejects malformed session routing keys", async () => {
    const response = await SELF.fetch("https://worker.test/api/snapshot", {
      headers: { "X-Session-Id": "short" },
    });
    expect(response.status).toBe(403);
  });

  it("keeps legacy no-header reads while requiring session keys for store writes", async () => {
    const read = await SELF.fetch("https://worker.test/api/store/products");
    expect(read.status).toBe(200);
    const write = await SELF.fetch(
      "https://worker.test/api/store/carts/legacy-cart/items",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: "PRD-001", quantity: 1 }),
      },
    );
    expect(write.status).toBe(401);
    const body = (await write.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });
});
