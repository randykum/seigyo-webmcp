import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Proposal } from "@seigyo/contracts";

const apiMock = vi.hoisted(() => ({
  incidents: vi.fn(),
  incident: vi.fn(),
  metrics: vi.fn(),
  logs: vi.fn(),
  deployments: vi.fn(),
  dependencies: vi.fn(),
  investigate: vi.fn(),
  propose: vi.fn(),
  execute: vi.fn(),
  verify: vi.fn(),
  undo: vi.fn(),
}));

vi.mock("./api", () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

import {
  getAgentConsoleSnapshot,
  resetAgentConsoleState,
  resolvePendingApproval,
} from "./agentConsole";
import { registerSeigyoTools } from "./webmcp";

const proposal: Proposal = {
  id: "PROP-1",
  incidentId: "INC-042",
  epoch: 1,
  causalRevision: 1,
  action: {
    type: "rollback_deployment",
    targetService: "checkout-api",
    parameters: {},
  },
  actionHash: "hash",
  rationale: "The current deployment is the correlated root cause.",
  evidenceRefs: ["deployment:DEP-160"],
  status: "pending",
  expiresAt: 1,
  predictedImpact: {
    classification: "recovery",
    risk: "low",
    summary: "Expected to restore checkout.",
    expectedErrorRate: 0.001,
    expectedP95Ms: 500,
    reversible: true,
  },
};

type Registered = {
  name: string;
  title: string;
  execute(input: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
};

const memory = new Map<string, string>();

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  });
  memory.clear();
  resetAgentConsoleState();
});

describe("Seigyo WebMCP lifecycle", () => {
  it("emits the natural tool label immediately and exits after two quiet seconds", async () => {
    const registered = new Map<string, Registered>();
    vi.stubGlobal("document", {
      modelContext: {
        registerTool: (tool: Registered) => registered.set(tool.name, tool),
      },
    });
    apiMock.incidents.mockResolvedValue({ incidents: [] });
    registerSeigyoTools();
    const result = registered.get("seigyo.list_incidents")?.execute({});
    expect(getAgentConsoleSnapshot().visible).toBe(true);
    expect(getAgentConsoleSnapshot().calls[0]?.label).toBe("Listing incidents");
    await result;
    expect(getAgentConsoleSnapshot().calls[0]?.state).toBe("complete");
    await vi.advanceTimersByTimeAsync(1999);
    expect(getAgentConsoleSnapshot().visible).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(getAgentConsoleSnapshot().visible).toBe(false);
  });

  it("keeps concurrent calls distinct and cancels a scheduled exit on re-entry", async () => {
    const registered = new Map<string, Registered>();
    vi.stubGlobal("document", {
      modelContext: {
        registerTool: (tool: Registered) => registered.set(tool.name, tool),
      },
    });
    apiMock.incidents.mockResolvedValue({ incidents: [] });
    apiMock.deployments.mockResolvedValue([]);
    registerSeigyoTools();
    await Promise.all([
      registered.get("seigyo.list_incidents")?.execute({}),
      registered.get("seigyo.list_deployments")?.execute({}),
    ]);
    const calls = getAgentConsoleSnapshot().calls;
    expect(new Set(calls.map((call) => call.callId)).size).toBe(2);
    await vi.advanceTimersByTimeAsync(1500);
    const resumed = registered.get("seigyo.list_incidents")?.execute({});
    expect(getAgentConsoleSnapshot().visible).toBe(true);
    await resumed;
    await vi.advanceTimersByTimeAsync(1999);
    expect(getAgentConsoleSnapshot().visible).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(getAgentConsoleSnapshot().visible).toBe(false);
  });

  it("keeps proposal execution pending until approval and does not execute on approval", async () => {
    const registered = new Map<string, Registered>();
    vi.stubGlobal("document", {
      modelContext: {
        registerTool: (tool: Registered) => registered.set(tool.name, tool),
      },
    });
    apiMock.propose.mockResolvedValue(proposal);
    apiMock.execute.mockResolvedValue({ id: "EXEC-1", state: "succeeded" });
    registerSeigyoTools();

    let settled = false;
    const pending = registered
      .get("seigyo.propose_action")
      ?.execute({
        incidentId: "INC-042",
        action: proposal.action,
        rationale: proposal.rationale,
        evidenceRefs: proposal.evidenceRefs,
        idempotencyKey: "proposal-test-001",
      })
      .then((value) => {
        settled = true;
        return value;
      });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(getAgentConsoleSnapshot().approvals[0]?.proposal.id).toBe("PROP-1");

    memory.set("approval:PROP-1", "bound-token");
    resolvePendingApproval("PROP-1", {
      proposal: { ...proposal, status: "approved" },
      decision: "approved",
    });
    await pending;
    expect(apiMock.execute).not.toHaveBeenCalled();

    await registered.get("seigyo.execute_action")?.execute({
      proposalId: "PROP-1",
      idempotencyKey: "execution-test-001",
    });
    expect(apiMock.execute).toHaveBeenCalledWith(
      "PROP-1",
      "bound-token",
      "execution-test-001",
      undefined,
    );
  });

  it("resolves rejection using the shared USER_REJECTED contract", async () => {
    const registered = new Map<string, Registered>();
    vi.stubGlobal("document", {
      modelContext: {
        registerTool: (tool: Registered) => registered.set(tool.name, tool),
      },
    });
    apiMock.propose.mockResolvedValue(proposal);
    registerSeigyoTools();
    const pending = registered.get("seigyo.propose_action")?.execute({
      incidentId: "INC-042",
      action: proposal.action,
      rationale: proposal.rationale,
      evidenceRefs: proposal.evidenceRefs,
      idempotencyKey: "proposal-test-reject",
    });
    await Promise.resolve();
    await Promise.resolve();
    resolvePendingApproval("PROP-1", {
      ok: false,
      error: {
        code: "USER_REJECTED",
        message: "The human rejected the proposed intervention.",
      },
    });
    const result = (await pending) as { structuredContent: unknown };
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "USER_REJECTED" },
    });
  });

  it("removes the approval waiter when the host cancels the tool call", async () => {
    const registered = new Map<string, Registered>();
    vi.stubGlobal("document", {
      modelContext: {
        registerTool: (tool: Registered) => registered.set(tool.name, tool),
      },
    });
    apiMock.propose.mockResolvedValue(proposal);
    registerSeigyoTools();
    const controller = new AbortController();
    const pending = registered.get("seigyo.propose_action")?.execute(
      {
        incidentId: "INC-042",
        action: proposal.action,
        rationale: proposal.rationale,
        evidenceRefs: proposal.evidenceRefs,
        idempotencyKey: "proposal-test-abort",
      },
      { signal: controller.signal },
    );
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(getAgentConsoleSnapshot().approvals).toHaveLength(0);
  });
});
