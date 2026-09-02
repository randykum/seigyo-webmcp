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

  it("rejects an oversized mutating request", async () => {
    const response = await SELF.fetch("https://worker.test/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "70000", "X-Session-Id": "seigyo-demo-operator" },
      body: JSON.stringify({ value: "small" })
    });
    expect(response.status).toBe(400);
    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_ARGUMENT");
  });

  it("rejects an oversized body when content length is missing", async () => {
    const response = await SELF.fetch("https://worker.test/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Id": "seigyo-demo-operator" },
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
});
