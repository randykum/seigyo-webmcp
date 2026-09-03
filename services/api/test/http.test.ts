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
});
