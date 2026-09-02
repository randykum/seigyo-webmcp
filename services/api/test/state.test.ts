import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("OperationsStateObject", () => {
  it("persists one strongly consistent workspace", async () => {
    const state = env.OPERATIONS_STATE.getByName("test-workspace");
    const first = await state.getSnapshot();
    const second = await state.getSnapshot();
    expect(second.epoch).toBe(first.epoch);
    expect(second.services).toHaveLength(7);
    expect(second.services.every(service => Boolean(service.hosting.providerName))).toBe(true);
    expect(second.incidents.length).toBeGreaterThanOrEqual(30);
    expect(second.deployments.length).toBeGreaterThanOrEqual(60);
  });

  it("returns hosting metadata with dependency nodes", async () => {
    const state = env.OPERATIONS_STATE.getByName("dependency-workspace");
    const dependencies = await state.listDependencies("checkout-api");
    expect(dependencies.edges.length).toBeGreaterThan(0);
    expect(dependencies.nodes.find(node => node.id === "checkout-api")?.hosting.providerName).toBe("Render");
  });

  it("invalidates proposals after reset", async () => {
    const state = env.OPERATIONS_STATE.getByName("reset-workspace");
    const before = await state.getSnapshot();
    const after = await state.reset("payment-outage");
    expect(after.epoch).toBe(before.epoch + 1);
    expect(after.scenario).toBe("payment-outage");
  });
});
