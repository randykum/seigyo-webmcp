import type { Proposal } from "@seigyo/contracts";

export const toolLabels = {
  "seigyo.list_incidents": "Listing incidents",
  "seigyo.get_incident": "Reading incident details",
  "seigyo.query_metrics": "Reading service metrics",
  "seigyo.search_logs": "Searching logs",
  "seigyo.list_deployments": "Listing deployments",
  "seigyo.list_dependencies": "Mapping dependencies",
  "seigyo.investigate_incident": "Investigating incident",
  "seigyo.propose_action": "Preparing recovery proposal",
  "seigyo.execute_action": "Executing approved recovery",
  "seigyo.verify_action": "Verifying recovery",
  "seigyo.undo_action": "Reverting intervention",
} as const;

export type ToolName = keyof typeof toolLabels;
export type ToolCallState = "running" | "complete" | "failed" | "cancelled";

export interface ToolCallEvent {
  callId: string;
  toolName: ToolName;
  label: string;
  state: ToolCallState;
  startedAt: number;
  finishedAt?: number;
}

export interface PendingApproval {
  proposal: Proposal;
  callId: string;
  localExpiresAt: number;
}

export interface AgentConsoleSnapshot {
  calls: ToolCallEvent[];
  approvals: PendingApproval[];
  visible: boolean;
}

type Decision =
  | { proposal: Proposal; decision: "approved" }
  | {
      ok: false;
      error: { code: "USER_REJECTED" | "STALE_STATE"; message: string };
    };

type Waiter = {
  resolve(value: Decision): void;
  reject(reason: unknown): void;
  signal?: AbortSignal;
  onAbort?: () => void;
  timer: number;
};

const listeners = new Set<() => void>();
const waiters = new Map<string, Set<Waiter>>();
const dismissLocks = new Set<"pointer" | "focus">();
let hideTimer: number | undefined;
export const AGENT_CONSOLE_QUIET_MS = 5000;
let snapshot: AgentConsoleSnapshot = {
  calls: [],
  approvals: [],
  visible: false,
};

const publish = (next: AgentConsoleSnapshot): void => {
  snapshot = next;
  for (const listener of listeners) listener();
};

const clearHideTimer = (): void => {
  if (hideTimer !== undefined) window.clearTimeout(hideTimer);
  hideTimer = undefined;
};

const scheduleHide = (): void => {
  clearHideTimer();
  if (
    dismissLocks.size > 0 ||
    snapshot.calls.some((call) => call.state === "running") ||
    snapshot.approvals.length > 0
  )
    return;
  hideTimer = window.setTimeout(() => {
    publish({ ...snapshot, visible: false });
    hideTimer = undefined;
  }, AGENT_CONSOLE_QUIET_MS);
};

const retainCalls = (calls: ToolCallEvent[]): ToolCallEvent[] => [
  ...calls.filter((call) => call.state === "running"),
  ...calls.filter((call) => call.state !== "running").slice(0, 12),
];

export const setAgentConsoleDismissLock = (
  source: "pointer" | "focus",
  locked: boolean,
): void => {
  if (locked) {
    dismissLocks.add(source);
    clearHideTimer();
    return;
  }
  dismissLocks.delete(source);
  scheduleHide();
};

export const subscribeAgentConsole = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getAgentConsoleSnapshot = (): AgentConsoleSnapshot => snapshot;

export const emitToolStarted = (callId: string, toolName: ToolName): void => {
  clearHideTimer();
  const call: ToolCallEvent = {
    callId,
    toolName,
    label: toolLabels[toolName],
    state: "running",
    startedAt: Date.now(),
  };
  publish({
    ...snapshot,
    calls: retainCalls([call, ...snapshot.calls]),
    visible: true,
  });
};

export const emitToolFinished = (
  callId: string,
  state: Exclude<ToolCallState, "running">,
): void => {
  publish({
    ...snapshot,
    calls: retainCalls(
      snapshot.calls.map((call) =>
        call.callId === callId
          ? { ...call, state, finishedAt: Date.now() }
          : call,
      ),
    ),
  });
  scheduleHide();
};

const cleanupWaiter = (proposalId: string, waiter: Waiter): void => {
  window.clearTimeout(waiter.timer);
  if (waiter.signal && waiter.onAbort)
    waiter.signal.removeEventListener("abort", waiter.onAbort);
  const proposalWaiters = waiters.get(proposalId);
  proposalWaiters?.delete(waiter);
  if (proposalWaiters?.size === 0) waiters.delete(proposalId);
};

const removeApproval = (proposalId: string): void => {
  publish({
    ...snapshot,
    approvals: snapshot.approvals.filter(
      (entry) => entry.proposal.id !== proposalId,
    ),
  });
  scheduleHide();
};

export const waitForHumanDecision = (
  proposal: Proposal,
  callId: string,
  signal?: AbortSignal,
): Promise<Decision> => {
  clearHideTimer();
  const localExpiresAt = Date.now() + 10 * 60_000;
  if (!snapshot.approvals.some((entry) => entry.proposal.id === proposal.id)) {
    publish({
      ...snapshot,
      approvals: [...snapshot.approvals, { proposal, callId, localExpiresAt }],
      visible: true,
    });
  }
  return new Promise<Decision>((resolve, reject) => {
    const waiter = {} as Waiter;
    waiter.resolve = resolve;
    waiter.reject = reject;
    waiter.signal = signal;
    waiter.timer = window.setTimeout(() => {
      cleanupWaiter(proposal.id, waiter);
      removeApproval(proposal.id);
      resolve({
        ok: false,
        error: {
          code: "STALE_STATE",
          message: "The recovery proposal expired before a decision was made.",
        },
      });
    }, 10 * 60_000);
    waiter.onAbort = () => {
      cleanupWaiter(proposal.id, waiter);
      if (!waiters.has(proposal.id)) removeApproval(proposal.id);
      reject(
        signal?.reason ?? new DOMException("Tool call cancelled", "AbortError"),
      );
    };
    if (signal?.aborted) {
      waiter.onAbort();
      return;
    }
    signal?.addEventListener("abort", waiter.onAbort, { once: true });
    const proposalWaiters = waiters.get(proposal.id) ?? new Set<Waiter>();
    proposalWaiters.add(waiter);
    waiters.set(proposal.id, proposalWaiters);
  });
};

export const resolvePendingApproval = (
  proposalId: string,
  decision: Decision,
): void => {
  const proposalWaiters = waiters.get(proposalId);
  if (proposalWaiters) {
    for (const waiter of [...proposalWaiters]) {
      cleanupWaiter(proposalId, waiter);
      waiter.resolve(decision);
    }
  }
  removeApproval(proposalId);
};

export const cancelAllPendingApprovals = (message: string): void => {
  for (const approval of snapshot.approvals) {
    resolvePendingApproval(approval.proposal.id, {
      ok: false,
      error: { code: "STALE_STATE", message },
    });
  }
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith("approval:")) sessionStorage.removeItem(key);
  }
};

export const resetAgentConsoleState = (): void => {
  clearHideTimer();
  dismissLocks.clear();
  for (const proposalWaiters of waiters.values()) {
    for (const waiter of proposalWaiters) {
      window.clearTimeout(waiter.timer);
      if (waiter.signal && waiter.onAbort)
        waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
  }
  waiters.clear();
  publish({ calls: [], approvals: [], visible: false });
};
