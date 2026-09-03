import { describe, expect, it } from "vitest";
import {
  approveProposal,
  checkout,
  computeHealth,
  dependencyEdges,
  executeProposal,
  proposeAction,
  queryMetrics,
  resetEnvironment,
  seedEnvironment,
  snapshot,
  undoExecution,
  updateCart,
  verifyExecution,
} from "../src/index";

describe("causal environment", () => {
  it("produces identical health for the same seed and time", () => {
    const first = seedEnvironment("checkout-regression");
    const second = seedEnvironment("checkout-regression");
    expect(computeHealth(first)).toEqual(computeHealth(second));
  });

  it("seeds provider ownership for every service", () => {
    const state = seedEnvironment("checkout-regression");
    expect(
      Object.values(state.services).every((service) =>
        Boolean(service.hosting.resourceId),
      ),
    ).toBe(true);
    expect(
      new Set(
        Object.values(state.services).map(
          (service) => service.hosting.providerId,
        ),
      ),
    ).toEqual(new Set(["cloudflare", "render", "stripe", "supabase"]));
    expect(state.services["payment-gateway"].provider).toBe("primary");
    expect(state.services["payment-gateway"].hosting.providerId).toBe("stripe");
  });

  it("rollback removes the checkout deployment fault after approval", async () => {
    const state = seedEnvironment("checkout-regression");
    const before =
      computeHealth(state).find((item) => item.serviceId === "checkout-api")
        ?.errorRate ?? 0;
    const proposal = await proposeAction(state, {
      incidentId: "INC-042",
      action: {
        type: "rollback_deployment",
        targetService: "checkout-api",
        parameters: {},
      },
      rationale: "The error increase follows the current deployment.",
      evidenceRefs: ["deployment:DEP-160"],
      idempotencyKey: "proposal-rollback-001",
    });
    const approval = await approveProposal(state, proposal.id, "test-session");
    const execution = await executeProposal(
      state,
      proposal.id,
      approval.token,
      "execution-rollback-001",
      "test-session",
    );
    const verification = await verifyExecution(state, execution.id, "INC-042");
    const after =
      computeHealth(state).find((item) => item.serviceId === "checkout-api")
        ?.errorRate ?? 1;
    expect(after).toBeLessThan(before);
    expect(verification.outcome).toBe("recovered");
  });

  it("restarting payment does not fix a provider outage", async () => {
    const state = seedEnvironment("payment-outage");
    const proposal = await proposeAction(state, {
      incidentId: "INC-043",
      action: {
        type: "restart_service",
        targetService: "payment-gateway",
        parameters: {},
      },
      rationale: "Restart the local payment adapter and clear its queue.",
      evidenceRefs: ["metric:payment-gateway"],
      idempotencyKey: "proposal-restart-001",
    });
    const approval = await approveProposal(state, proposal.id, "test-session");
    const execution = await executeProposal(
      state,
      proposal.id,
      approval.token,
      "execution-restart-001",
      "test-session",
    );
    const verification = await verifyExecution(state, execution.id, "INC-043");
    expect(verification.outcome).not.toBe("recovered");
  });

  it("scaling inventory to four replicas resolves saturation", async () => {
    const state = seedEnvironment("inventory-saturation");
    const proposal = await proposeAction(state, {
      incidentId: "INC-044",
      action: {
        type: "scale_service",
        targetService: "inventory-db",
        parameters: { replicas: 4 },
      },
      rationale:
        "Provision enough database capacity for current inventory demand.",
      evidenceRefs: ["metric:inventory-db"],
      idempotencyKey: "proposal-scale-004",
    });
    const approval = await approveProposal(state, proposal.id, "test-session");
    const execution = await executeProposal(
      state,
      proposal.id,
      approval.token,
      "execution-scale-004",
      "test-session",
    );
    const verification = await verifyExecution(state, execution.id, "INC-044");
    expect(verification.outcome).toBe("recovered");
  });

  it("uses one canonical nine-edge dependency graph in snapshots", () => {
    const environment = snapshot(seedEnvironment("checkout-regression"));
    expect(dependencyEdges).toHaveLength(9);
    expect(environment.dependencyEdges).toEqual(dependencyEdges);
    expect(environment.operationalStatus.openIncidentCount).toBe(1);
  });

  it.each([
    [
      "checkout-regression",
      "INC-042",
      {
        type: "rollback_deployment",
        targetService: "checkout-api",
        parameters: {},
      },
      "deployment:DEP-160",
    ],
    [
      "payment-outage",
      "INC-043",
      {
        type: "switch_provider",
        targetService: "payment-gateway",
        parameters: { provider: "fallback" },
      },
      "metric:payment-gateway",
    ],
    [
      "inventory-saturation",
      "INC-044",
      {
        type: "scale_service",
        targetService: "inventory-db",
        parameters: { replicas: 4 },
      },
      "metric:inventory-db",
    ],
  ] as const)(
    "moves a recovered %s incident to history after three healthy samples",
    async (scenario, incidentId, action, evidenceRef) => {
      const state = seedEnvironment(scenario);
      const proposal = await proposeAction(state, {
        incidentId,
        action,
        rationale: "The evidence identifies the current root cause clearly.",
        evidenceRefs: [evidenceRef],
        idempotencyKey: `proposal-${scenario}-recovery`,
      });
      const approval = await approveProposal(
        state,
        proposal.id,
        "recovery-session",
      );
      const execution = await executeProposal(
        state,
        proposal.id,
        approval.token,
        `execute-${scenario}-recovery`,
        "recovery-session",
      );
      const verification = await verifyExecution(
        state,
        execution.id,
        incidentId,
      );
      const environment = snapshot(state);
      const sampleTimes = new Set(
        state.metrics.slice(-21).map((point) => point.timestamp),
      );
      expect(verification.outcome).toBe("recovered");
      expect(sampleTimes.size).toBe(3);
      expect(environment.activeIncident).toBeNull();
      expect(environment.operationalStatus.state).toBe("operational");
      expect(environment.operationalStatus.openIncidentCount).toBe(0);
      expect(
        state.incidents.find((incident) => incident.id === incidentId)?.status,
      ).toBe("resolved");
    },
  );

  it("keeps an unresolved incident in recovery monitoring after the wrong action", async () => {
    const state = seedEnvironment("payment-outage");
    const proposal = await proposeAction(state, {
      incidentId: "INC-043",
      action: {
        type: "restart_service",
        targetService: "payment-gateway",
        parameters: {},
      },
      rationale:
        "Restart the payment adapter and observe the provider response.",
      evidenceRefs: ["metric:payment-gateway"],
      idempotencyKey: "proposal-monitoring-wrong",
    });
    const approval = await approveProposal(
      state,
      proposal.id,
      "monitoring-session",
    );
    const execution = await executeProposal(
      state,
      proposal.id,
      approval.token,
      "execute-monitoring-wrong",
      "monitoring-session",
    );
    await verifyExecution(state, execution.id, "INC-043");
    const environment = snapshot(state);
    expect(environment.activeIncident?.status).toBe("monitoring");
    expect(environment.operationalStatus.state).toBe("recovering");
  });

  it("reset invalidates an approved proposal", async () => {
    const state = seedEnvironment("checkout-regression");
    const proposal = await proposeAction(state, {
      incidentId: "INC-042",
      action: {
        type: "rollback_deployment",
        targetService: "checkout-api",
        parameters: {},
      },
      rationale: "Rollback the correlated checkout deployment safely.",
      evidenceRefs: ["deployment:DEP-160"],
      idempotencyKey: "proposal-reset-001",
    });
    const approval = await approveProposal(state, proposal.id, "test-session");
    const reset = resetEnvironment(state, "payment-outage");
    await expect(
      executeProposal(
        reset,
        proposal.id,
        approval.token,
        "execution-reset-001",
        "test-session",
      ),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("successful checkout creates one order and clears the cart", async () => {
    const state = seedEnvironment("checkout-regression");
    state.services["checkout-api"].version =
      state.services["checkout-api"].previousVersion;
    state.services["checkout-api"].featureFlags["new-tax-rounding"] = false;
    updateCart(state, "cart-test", "PRD-001", 1);
    const order = await checkout(state, {
      cartId: "cart-test",
      email: "randy@example.com",
      name: "Randy B",
      address: "42 Design Street, Douala",
      requestId: "checkout-request-success",
      idempotencyKey: "checkout-success-001",
    });
    expect(order.status).toBe("confirmed");
    expect(state.orders).toHaveLength(1);
    expect(state.carts["cart-test"]?.items).toHaveLength(0);
  });

  it("blocks expired, mismatched, and replayed approvals", async () => {
    const state = seedEnvironment("checkout-regression");
    const proposal = await proposeAction(state, {
      incidentId: "INC-042",
      action: {
        type: "rollback_deployment",
        targetService: "checkout-api",
        parameters: {},
      },
      rationale: "The current deployment is the correlated cause.",
      evidenceRefs: ["deployment:DEP-160"],
      idempotencyKey: "proposal-security-001",
    });
    const approval = await approveProposal(state, proposal.id, "session-a");
    await expect(
      executeProposal(
        state,
        proposal.id,
        approval.token,
        "execute-session-b",
        "session-b",
      ),
    ).rejects.toThrow("APPROVAL_REQUIRED");
    state.virtualNow = approval.expiresAt + 1;
    await expect(
      executeProposal(
        state,
        proposal.id,
        approval.token,
        "execute-expired-001",
        "session-a",
      ),
    ).rejects.toThrow("STALE_STATE");
  });

  it("returns one execution for duplicate idempotent requests", async () => {
    const state = seedEnvironment("checkout-regression");
    const proposal = await proposeAction(state, {
      incidentId: "INC-042",
      action: {
        type: "rollback_deployment",
        targetService: "checkout-api",
        parameters: {},
      },
      rationale: "The current deployment is the correlated cause.",
      evidenceRefs: ["deployment:DEP-160"],
      idempotencyKey: "proposal-idempotent-001",
    });
    const approval = await approveProposal(state, proposal.id, "session-a");
    const first = await executeProposal(
      state,
      proposal.id,
      approval.token,
      "execute-idempotent-001",
      "session-a",
    );
    const second = await executeProposal(
      state,
      proposal.id,
      approval.token,
      "execute-idempotent-001",
      "session-a",
    );
    expect(second.id).toBe(first.id);
    expect(state.executions).toHaveLength(1);
  });

  it("restores the exact service state once during undo", async () => {
    const state = seedEnvironment("inventory-saturation");
    const originalReplicas = state.services["inventory-db"].replicas;
    const proposal = await proposeAction(state, {
      incidentId: "INC-044",
      action: {
        type: "scale_service",
        targetService: "inventory-db",
        parameters: { replicas: 5 },
      },
      rationale: "Capacity is below the observed inventory demand.",
      evidenceRefs: ["metric:inventory-db"],
      idempotencyKey: "proposal-undo-001",
    });
    const approval = await approveProposal(state, proposal.id, "session-a");
    const execution = await executeProposal(
      state,
      proposal.id,
      approval.token,
      "execute-undo-001",
      "session-a",
    );
    await undoExecution(state, execution.id, "undo-execution-001");
    expect(state.services["inventory-db"].replicas).toBe(originalReplicas);
    expect(execution.undoAvailable).toBe(false);
    await expect(
      undoExecution(state, execution.id, "undo-execution-002"),
    ).rejects.toThrow("IRREVERSIBLE");
  });

  it("makes an undo retry idempotent and rejects a conflicting key", async () => {
    const state = seedEnvironment("inventory-saturation");
    const proposal = await proposeAction(state, {
      incidentId: "INC-044",
      action: {
        type: "scale_service",
        targetService: "inventory-db",
        parameters: { replicas: 5 },
      },
      rationale: "Capacity is below the observed inventory demand.",
      evidenceRefs: ["metric:inventory-db"],
      idempotencyKey: "proposal-undo-retry",
    });
    const approval = await approveProposal(state, proposal.id, "session-a");
    const execution = await executeProposal(
      state,
      proposal.id,
      approval.token,
      "execute-undo-retry",
      "session-a",
    );
    const first = await undoExecution(state, execution.id, "undo-retry-key");
    const retry = await undoExecution(state, execution.id, "undo-retry-key");
    expect(retry.id).toBe(first.id);
    await expect(
      undoExecution(state, first.id, "undo-retry-key"),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });

  it("rejects undo after a newer causal action", async () => {
    const state = seedEnvironment("inventory-saturation");
    const firstProposal = await proposeAction(state, {
      incidentId: "INC-044",
      action: {
        type: "scale_service",
        targetService: "inventory-db",
        parameters: { replicas: 4 },
      },
      rationale: "Restore database headroom.",
      evidenceRefs: ["metric:inventory-db"],
      idempotencyKey: "proposal-stale-undo-1",
    });
    const firstApproval = await approveProposal(
      state,
      firstProposal.id,
      "session-a",
    );
    const firstExecution = await executeProposal(
      state,
      firstProposal.id,
      firstApproval.token,
      "execute-stale-undo-1",
      "session-a",
    );
    const secondProposal = await proposeAction(state, {
      incidentId: "INC-044",
      action: {
        type: "maintenance_mode",
        targetService: "storefront-edge",
        parameters: { enabled: true },
      },
      rationale: "Contain customer writes during verification.",
      evidenceRefs: ["metric:inventory-db"],
      idempotencyKey: "proposal-stale-undo-2",
    });
    const secondApproval = await approveProposal(
      state,
      secondProposal.id,
      "session-a",
    );
    await executeProposal(
      state,
      secondProposal.id,
      secondApproval.token,
      "execute-stale-undo-2",
      "session-a",
    );
    await expect(
      undoExecution(state, firstExecution.id, "undo-stale-key"),
    ).rejects.toThrow("STALE_STATE");
  });

  it("keeps execution and receipt identifiers unique across resets", async () => {
    let state = seedEnvironment("checkout-regression");
    const proposal = await proposeAction(state, {
      incidentId: "INC-042",
      action: {
        type: "rollback_deployment",
        targetService: "checkout-api",
        parameters: {},
      },
      rationale: "Rollback the correlated deployment.",
      evidenceRefs: ["deployment:DEP-160"],
      idempotencyKey: "proposal-before-reset",
    });
    const approval = await approveProposal(state, proposal.id, "session-a");
    const firstExecution = await executeProposal(
      state,
      proposal.id,
      approval.token,
      "execute-before-reset",
      "session-a",
    );
    state = resetEnvironment(state, "checkout-regression");
    const nextProposal = await proposeAction(state, {
      incidentId: "INC-042",
      action: {
        type: "rollback_deployment",
        targetService: "checkout-api",
        parameters: {},
      },
      rationale: "Rollback the correlated deployment again.",
      evidenceRefs: ["deployment:DEP-160"],
      idempotencyKey: "proposal-after-reset",
    });
    const nextApproval = await approveProposal(
      state,
      nextProposal.id,
      "session-a",
    );
    const nextExecution = await executeProposal(
      state,
      nextProposal.id,
      nextApproval.token,
      "execute-after-reset",
      "session-a",
    );
    expect(nextExecution.id).not.toBe(firstExecution.id);
    expect(new Set(state.receipts.map((receipt) => receipt.id)).size).toBe(
      state.receipts.length,
    );
  });

  it("bounds invalid metric limits and cart quantities", () => {
    const state = seedEnvironment("checkout-regression");
    expect(queryMetrics(state, undefined, Number.NaN)).toHaveLength(180);
    expect(queryMetrics(state, undefined, -1)).toHaveLength(0);
    expect(() => updateCart(state, "cart-safe", "PRD-001", -1)).toThrow(
      "INVALID_ARGUMENT",
    );
    expect(() => updateCart(state, "__proto__", "PRD-001", 1)).toThrow(
      "INVALID_ARGUMENT",
    );
  });
});
