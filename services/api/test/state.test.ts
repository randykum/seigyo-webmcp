import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("OperationsStateObject", () => {
  it("persists one strongly consistent workspace", async () => {
    const state = env.OPERATIONS_STATE.getByName("test-workspace");
    const first = await state.getSnapshot();
    const second = await state.getSnapshot();
    expect(second.epoch).toBe(first.epoch);
    expect(second.services).toHaveLength(7);
    expect(
      second.services.every((service) => Boolean(service.hosting.providerName)),
    ).toBe(true);
    expect(second.incidents.length).toBeGreaterThanOrEqual(30);
    expect(second.deployments.length).toBeGreaterThanOrEqual(60);
    expect(second.dependencyEdges).toHaveLength(9);
    expect(second.activeIncident).toBeNull();
    expect(second.operationalStatus.openIncidentCount).toBe(0);
    expect(second.operationalStatus.state).toBe("operational");
  }, 15_000);

  it("returns hosting metadata with dependency nodes", async () => {
    const state = env.OPERATIONS_STATE.getByName("dependency-workspace");
    const dependencies = await state.listDependencies("checkout-api");
    expect(dependencies.edges).toHaveLength(4);
    expect(
      dependencies.edges.every((edge) => typeof edge.weight === "number"),
    ).toBe(true);
    expect(
      dependencies.nodes.find((node) => node.id === "checkout-api")?.hosting
        .providerName,
    ).toBe("Render");
  });

  it("keeps carts and operating conditions isolated by session object", async () => {
    const first = env.OPERATIONS_STATE.getByName("seigyo-session-isolation-a");
    const second = env.OPERATIONS_STATE.getByName("seigyo-session-isolation-b");
    await first.reset("checkout-regression");
    await second.reset("payment-outage");
    await first.setCartItem("session-cart", "PRD-001", 2);

    const firstSnapshot = await first.getSnapshot();
    const secondSnapshot = await second.getSnapshot();
    expect(firstSnapshot.scenario).toBe("checkout-regression");
    expect(secondSnapshot.scenario).toBe("payment-outage");
    expect((await first.getCart("session-cart")).items).toEqual([
      { productId: "PRD-001", quantity: 2 },
    ]);
    expect((await second.getCart("session-cart")).items).toEqual([]);
  });

  it("invalidates proposals after reset", async () => {
    const state = env.OPERATIONS_STATE.getByName("reset-workspace");
    const before = await state.getSnapshot();
    const after = await state.reset("payment-outage");
    expect(after.epoch).toBe(before.epoch + 1);
    expect(after.scenario).toBe("payment-outage");
  });

  it("persists an idempotent checkout release after recovery", async () => {
    const state = env.OPERATIONS_STATE.getByName("checkout-release-workspace");
    await state.reset("checkout-regression");
    const proposal = await state.createProposal({
      incidentId: "INC-042",
      action: {
        type: "rollback_deployment",
        targetService: "checkout-api",
        parameters: {},
      },
      rationale: "Rollback the correlated checkout deployment safely.",
      evidenceRefs: ["deployment:DEP-160"],
      idempotencyKey: "state-release-proposal",
    });
    const approval = await state.approve(proposal.id, "state-release-session");
    const execution = await state.execute(
      proposal.id,
      approval.token,
      "state-release-execution",
      "state-release-session",
    );
    await state.verify(execution.id, proposal.incidentId);
    const recovered = await state.getSnapshot();
    expect(recovered.operationalStatus.state).toBe("operational");

    const first = await state.deployCheckoutRevision({
      idempotencyKey: "state-checkout-release",
    });
    const second = await state.deployCheckoutRevision({
      idempotencyKey: "state-checkout-release",
    });
    const persisted = await state.getSnapshot();
    expect(second).toEqual(first);
    expect(persisted.activeIncident?.id).toBe(first.incident.id);
    expect(persisted.deployments[0]?.id).toBe(first.deployment.id);
    expect(persisted.incidents.some((item) => item.id === "INC-042")).toBe(
      true,
    );
  });

  it("restores an incident workspace to a healthy baseline", async () => {
    const state = env.OPERATIONS_STATE.getByName("restore-workspace");
    await state.reset("checkout-regression");
    const before = await state.getSnapshot();
    const restored = await state.restoreHealthy();

    expect(restored.epoch).toBe(before.epoch + 1);
    expect(restored.activeIncident).toBeNull();
    expect(restored.operationalStatus.state).toBe("operational");
    expect((await state.listServices()).health.every((service) => service.status === "healthy")).toBe(
      true,
    );
  });
});
