import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("SimulationStateObject", () => {
  it("persists one strongly consistent workspace", async () => {
    const state = env.SIMULATION.getByName("test-workspace");
    const first = await state.getSnapshot();
    const second = await state.getSnapshot();
    expect(second.epoch).toBe(first.epoch);
    expect(second.services).toHaveLength(7);
    expect(second.incidents.length).toBeGreaterThanOrEqual(30);
    expect(second.deployments.length).toBeGreaterThanOrEqual(60);
  });

  it("invalidates proposals after reset", async () => {
    const state = env.SIMULATION.getByName("reset-workspace");
    const before = await state.getSnapshot();
    const after = await state.reset("payment-outage");
    expect(after.epoch).toBe(before.epoch + 1);
    expect(after.scenario).toBe("payment-outage");
  });
});
