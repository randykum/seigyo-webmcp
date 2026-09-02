import type { ApiResult, ProposalInput, ScenarioId, ServiceId } from "@seigyo/contracts";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const SESSION_ID = "seigyo-demo-operator";

export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Session-Id": SESSION_ID, ...init?.headers }
  });
  const result = await response.json() as ApiResult<T>;
  if (!result.ok) throw new ApiError(result.error.code, result.error.message);
  return result.data;
}

export const api = {
  snapshot: <T>() => request<T>("/api/snapshot"),
  incidents: <T>() => request<T>("/api/incidents"),
  incident: <T>(id: string) => request<T>(`/api/incidents/${encodeURIComponent(id)}`),
  services: <T>() => request<T>("/api/services"),
  deployments: <T>(serviceId?: ServiceId) => request<T>(`/api/deployments${serviceId ? `?serviceId=${serviceId}` : ""}`),
  dependencies: <T>(serviceId?: ServiceId) => request<T>(`/api/dependencies${serviceId ? `?serviceId=${serviceId}` : ""}`),
  metrics: <T>(serviceId?: ServiceId, limit = 180) => request<T>(`/api/metrics?limit=${limit}${serviceId ? `&serviceId=${serviceId}` : ""}`),
  logs: <T>(serviceId?: ServiceId, query = "", limit = 50) => request<T>(`/api/logs?limit=${limit}&query=${encodeURIComponent(query)}${serviceId ? `&serviceId=${serviceId}` : ""}`),
  runbooks: <T>() => request<T>("/api/runbooks"),
  receipts: <T>() => request<T>("/api/receipts"),
  activity: <T>() => request<T>("/api/agent-activity"),
  investigate: <T>(incidentId: string) => request<T>("/api/investigate", { method: "POST", body: JSON.stringify({ incidentId }) }),
  propose: <T>(input: ProposalInput) => request<T>("/api/proposals", { method: "POST", body: JSON.stringify(input) }),
  approve: <T>(proposalId: string) => request<T>(`/api/proposals/${proposalId}/approve`, { method: "POST" }),
  reject: <T>(proposalId: string) => request<T>(`/api/proposals/${proposalId}/reject`, { method: "POST" }),
  execute: <T>(proposalId: string, approvalToken: string, idempotencyKey: string) => request<T>("/api/executions", { method: "POST", body: JSON.stringify({ proposalId, approvalToken, idempotencyKey }) }),
  verify: <T>(executionId: string, incidentId: string) => request<T>("/api/verifications", { method: "POST", body: JSON.stringify({ executionId, incidentId, checks: ["service_health", "error_rate", "latency", "deployment", "dependency"] }) }),
  undo: <T>(executionId: string) => request<T>("/api/undo", { method: "POST", body: JSON.stringify({ executionId, idempotencyKey: crypto.randomUUID() }) }),
  reset: <T>(scenario: ScenarioId) => request<T>("/api/scenario/reset", { method: "POST", body: JSON.stringify({ scenario, confirmation: "RESET SIMULATION" }) })
};

export const websocketUrl = (): string => {
  if (API_BASE) return `${API_BASE.replace(/^http/, "ws")}/ws?session=${encodeURIComponent(SESSION_ID)}`;
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws?session=${encodeURIComponent(SESSION_ID)}`;
};
