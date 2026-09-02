import { describe, expect, it } from "vitest";
import { approveProposal, checkout, computeHealth, executeProposal, proposeAction, queryMetrics, resetSimulation, seedSimulation, undoExecution, updateCart, verifyExecution } from "../src/index";

describe("causal simulation", () => {
  it("produces identical health for the same seed and time", () => {
    const first = seedSimulation("checkout-regression");
    const second = seedSimulation("checkout-regression");
    expect(computeHealth(first)).toEqual(computeHealth(second));
  });

  it("rollback removes the checkout deployment fault after approval", async () => {
    const state = seedSimulation("checkout-regression");
    const before = computeHealth(state).find(item => item.serviceId === "checkout-api")?.errorRate ?? 0;
    const proposal = await proposeAction(state, { incidentId: "INC-042", action: { type: "rollback_deployment", targetService: "checkout-api", parameters: {} }, rationale: "The error increase follows the current deployment.", evidenceRefs: ["deployment:DEP-160"], idempotencyKey: "proposal-rollback-001" });
    const approval = await approveProposal(state, proposal.id, "test-session");
    const execution = await executeProposal(state, proposal.id, approval.token, "execution-rollback-001", "test-session");
    const verification = await verifyExecution(state, execution.id, "INC-042");
    const after = computeHealth(state).find(item => item.serviceId === "checkout-api")?.errorRate ?? 1;
    expect(after).toBeLessThan(before);
    expect(verification.outcome).toBe("recovered");
  });

  it("restarting payment does not fix a provider outage", async () => {
    const state = seedSimulation("payment-outage");
    const proposal = await proposeAction(state, { incidentId: "INC-043", action: { type: "restart_service", targetService: "payment-gateway", parameters: {} }, rationale: "Restart the local payment adapter and clear its queue.", evidenceRefs: ["metric:payment-gateway"], idempotencyKey: "proposal-restart-001" });
    const approval = await approveProposal(state, proposal.id, "test-session");
    const execution = await executeProposal(state, proposal.id, approval.token, "execution-restart-001", "test-session");
    const verification = await verifyExecution(state, execution.id, "INC-043");
    expect(verification.outcome).not.toBe("recovered");
  });

  it("scaling inventory to four replicas resolves saturation", async () => {
    const state = seedSimulation("inventory-saturation");
    const proposal = await proposeAction(state, { incidentId: "INC-044", action: { type: "scale_service", targetService: "inventory-db", parameters: { replicas: 4 } }, rationale: "Provision enough database capacity for current inventory demand.", evidenceRefs: ["metric:inventory-db"], idempotencyKey: "proposal-scale-004" });
    const approval = await approveProposal(state, proposal.id, "test-session");
    const execution = await executeProposal(state, proposal.id, approval.token, "execution-scale-004", "test-session");
    const verification = await verifyExecution(state, execution.id, "INC-044");
    expect(verification.outcome).toBe("recovered");
  });

  it("reset invalidates an approved proposal", async () => {
    const state = seedSimulation("checkout-regression");
    const proposal = await proposeAction(state, { incidentId: "INC-042", action: { type: "rollback_deployment", targetService: "checkout-api", parameters: {} }, rationale: "Rollback the correlated checkout deployment safely.", evidenceRefs: ["deployment:DEP-160"], idempotencyKey: "proposal-reset-001" });
    const approval = await approveProposal(state, proposal.id, "test-session");
    const reset = resetSimulation(state, "payment-outage");
    await expect(executeProposal(reset, proposal.id, approval.token, "execution-reset-001", "test-session")).rejects.toThrow("NOT_FOUND");
  });

  it("successful checkout creates one order and clears the cart", async () => {
    const state = seedSimulation("checkout-regression");
    state.services["checkout-api"].version = state.services["checkout-api"].previousVersion;
    state.services["checkout-api"].featureFlags["new-tax-rounding"] = false;
    updateCart(state, "cart-test", "PRD-001", 1);
    const order = await checkout(state, { cartId: "cart-test", email: "randy@example.com", name: "Randy B", address: "42 Design Street, Douala", requestId: "checkout-request-success", idempotencyKey: "checkout-success-001" });
    expect(order.status).toBe("confirmed");
    expect(state.orders).toHaveLength(1);
    expect(state.carts["cart-test"]?.items).toHaveLength(0);
  });

  it("blocks expired, mismatched, and replayed approvals", async () => {
    const state = seedSimulation("checkout-regression");
    const proposal = await proposeAction(state, { incidentId: "INC-042", action: { type: "rollback_deployment", targetService: "checkout-api", parameters: {} }, rationale: "The current deployment is the correlated cause.", evidenceRefs: ["deployment:DEP-160"], idempotencyKey: "proposal-security-001" });
    const approval = await approveProposal(state, proposal.id, "session-a");
    await expect(executeProposal(state, proposal.id, approval.token, "execute-session-b", "session-b")).rejects.toThrow("APPROVAL_REQUIRED");
    state.virtualNow = approval.expiresAt + 1;
    await expect(executeProposal(state, proposal.id, approval.token, "execute-expired-001", "session-a")).rejects.toThrow("STALE_STATE");
  });

  it("returns one execution for duplicate idempotent requests", async () => {
    const state = seedSimulation("checkout-regression");
    const proposal = await proposeAction(state, { incidentId: "INC-042", action: { type: "rollback_deployment", targetService: "checkout-api", parameters: {} }, rationale: "The current deployment is the correlated cause.", evidenceRefs: ["deployment:DEP-160"], idempotencyKey: "proposal-idempotent-001" });
    const approval = await approveProposal(state, proposal.id, "session-a");
    const first = await executeProposal(state, proposal.id, approval.token, "execute-idempotent-001", "session-a");
    const second = await executeProposal(state, proposal.id, approval.token, "execute-idempotent-001", "session-a");
    expect(second.id).toBe(first.id);
    expect(state.executions).toHaveLength(1);
  });

  it("restores the exact service state once during undo", async () => {
    const state = seedSimulation("inventory-saturation");
    const originalReplicas = state.services["inventory-db"].replicas;
    const proposal = await proposeAction(state, { incidentId: "INC-044", action: { type: "scale_service", targetService: "inventory-db", parameters: { replicas: 5 } }, rationale: "Capacity is below the observed inventory demand.", evidenceRefs: ["metric:inventory-db"], idempotencyKey: "proposal-undo-001" });
    const approval = await approveProposal(state, proposal.id, "session-a");
    const execution = await executeProposal(state, proposal.id, approval.token, "execute-undo-001", "session-a");
    await undoExecution(state, execution.id, "undo-execution-001");
    expect(state.services["inventory-db"].replicas).toBe(originalReplicas);
    expect(execution.undoAvailable).toBe(false);
    await expect(undoExecution(state, execution.id, "undo-execution-002")).rejects.toThrow("IRREVERSIBLE");
  });

  it("bounds invalid metric limits and cart quantities", () => {
    const state = seedSimulation("checkout-regression");
    expect(queryMetrics(state, undefined, Number.NaN)).toHaveLength(180);
    expect(queryMetrics(state, undefined, -1)).toHaveLength(0);
    expect(() => updateCart(state, "cart-safe", "PRD-001", -1)).toThrow("INVALID_ARGUMENT");
    expect(() => updateCart(state, "__proto__", "PRD-001", 1)).toThrow("INVALID_ARGUMENT");
  });
});
