import { z } from "zod";

export const serviceIds = ["storefront-edge", "catalog-api", "cart-api", "checkout-api", "payment-gateway", "inventory-db", "order-worker"] as const;
export const ServiceIdSchema = z.enum(serviceIds);
export type ServiceId = z.infer<typeof ServiceIdSchema>;

export const ScenarioSchema = z.enum(["checkout-regression", "payment-outage", "inventory-saturation"]);
export type ScenarioId = z.infer<typeof ScenarioSchema>;

export const ActionTypeSchema = z.enum(["rollback_deployment", "restart_service", "scale_service", "shift_traffic", "disable_feature", "switch_provider", "maintenance_mode"]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const ActionSchema = z.object({
  type: ActionTypeSchema,
  targetService: ServiceIdSchema,
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({})
}).strict();
export type RecoveryAction = z.infer<typeof ActionSchema>;

export const ProposalInputSchema = z.object({
  incidentId: z.string().trim().min(1).max(64),
  action: ActionSchema,
  rationale: z.string().trim().min(8).max(320),
  evidenceRefs: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  idempotencyKey: z.string().trim().regex(/^[a-zA-Z0-9_-]{8,100}$/)
}).strict();
export type ProposalInput = z.infer<typeof ProposalInputSchema>;

export const ExecutionInputSchema = z.object({
  proposalId: z.string().min(1).max(64),
  approvalToken: z.string().min(16).max(256),
  idempotencyKey: z.string().trim().regex(/^[a-zA-Z0-9_-]{8,100}$/)
}).strict();

export const VerifyInputSchema = z.object({
  executionId: z.string().min(1).max(64),
  incidentId: z.string().min(1).max(64),
  checks: z.array(z.enum(["service_health", "error_rate", "latency", "deployment", "dependency"])).min(1).max(5)
}).strict();

export const ResetInputSchema = z.object({ scenario: ScenarioSchema, confirmation: z.literal("RESET SIMULATION") });

export const CartItemInputSchema = z.object({ productId: z.string().trim().min(1).max(64), quantity: z.number().int().min(0).max(10) }).strict();
export const CheckoutInputSchema = z.object({
  cartId: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  email: z.string().email().max(160),
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(8).max(240),
  requestId: z.string().trim().regex(/^[a-zA-Z0-9_-]{8,100}$/),
  idempotencyKey: z.string().trim().regex(/^[a-zA-Z0-9_-]{8,100}$/)
}).strict();

export type ErrorCode = "INVALID_ARGUMENT" | "NOT_FOUND" | "AUTH_REQUIRED" | "APPROVAL_REQUIRED" | "STALE_STATE" | "PRECONDITION_FAILED" | "CONFLICT" | "RATE_LIMITED" | "UPSTREAM_UNAVAILABLE" | "USER_REJECTED" | "IRREVERSIBLE";
export type ApiResult<T> = { ok: true; data: T; stateVersion: number; traceId: string } | { ok: false; error: { code: ErrorCode; message: string; retryable: boolean; requiresHuman?: boolean }; stateVersion: number; traceId: string };

export interface ServiceRuntime {
  id: ServiceId;
  name: string;
  owner: string;
  version: string;
  previousVersion: string;
  replicas: number;
  minReplicas: number;
  maxReplicas: number;
  enabled: boolean;
  restartUntil: number | null;
  featureFlags: Record<string, boolean>;
  provider?: "primary" | "fallback";
}

export interface ServiceHealth { serviceId: ServiceId; status: "healthy" | "degraded" | "critical" | "maintenance"; requestRate: number; errorRate: number; p95Ms: number; queueDepth: number; utilization: number; availability: number; }
export interface MetricPoint extends ServiceHealth { timestamp: number; p50Ms: number; cpuPct: number; }
export interface LogEvent { id: string; timestamp: number; serviceId: ServiceId; level: "debug" | "info" | "warn" | "error"; eventName: string; message: string; traceId?: string; requestId?: string; metadata: Record<string, string | number | boolean>; }
export interface Incident { id: string; title: string; severity: "critical" | "high" | "medium" | "low"; status: "open" | "investigating" | "identified" | "mitigating" | "monitoring" | "resolved"; serviceId: ServiceId; startedAt: number; updatedAt: number; resolvedAt?: number; impact: string; customerErrorsPerMinute: number; ordersAtRisk: number; cause: string; }
export interface Deployment { id: string; serviceId: ServiceId; version: string; previousVersion: string; status: "success" | "failed" | "in_progress" | "rolled_back"; actor: string; commitSha: string; createdAt: number; summary: string; }
export interface Proposal { id: string; incidentId: string; epoch: number; causalRevision: number; action: RecoveryAction; actionHash: string; rationale: string; evidenceRefs: string[]; status: "pending" | "approved" | "executing" | "succeeded" | "failed" | "rejected" | "stale" | "expired"; expiresAt: number; predictedImpact: { classification: "recovery" | "partial" | "containment" | "unlikely"; risk: "low" | "medium" | "high"; summary: string; expectedErrorRate: number; expectedP95Ms: number; reversible: boolean; }; }
export interface Approval { proposalId: string; sessionId: string; actionHash: string; epoch: number; causalRevision: number; token: string; expiresAt: number; used: boolean; approvedAt: number; }
export interface Execution { id: string; proposalId: string; incidentId: string; state: "queued" | "running" | "succeeded" | "failed"; action: RecoveryAction; startedAt: number; finishedAt?: number; beforeStateHash: string; afterStateHash?: string; undoAvailable: boolean; }
export type VerificationOutcome = "recovered" | "contained" | "partially_recovered" | "unchanged" | "worsened";
export interface Verification { id: string; executionId: string; incidentId: string; outcome: VerificationOutcome; verifiedAt: number; checks: Array<{ name: string; status: "pass" | "fail" | "unknown"; observed: string; expected: string }>; residualRisk: string; }
export interface Receipt { id: string; incidentId: string; proposalId: string; executionId: string; action: RecoveryAction; actionHash: string; beforeStateHash: string; afterStateHash: string; evidenceRefs: string[]; approvedAt: number; executedAt: number; verifiedAt?: number; result: VerificationOutcome | "pending"; previousReceiptHash: string; receiptHash: string; epoch: number; undoOf?: string; }
export interface Product { id: string; slug: string; name: string; category: "Furniture" | "Lighting" | "Ceramics" | "Textiles" | "Objects"; material: string; description: string; price: number; inventory: number; image: string; dimensions: string; featured: boolean; }
export interface Cart { id: string; items: Array<{ productId: string; quantity: number }>; updatedAt: number; }
export interface Order { id: string; cartId: string; email: string; name: string; address: string; total: number; status: "confirmed" | "processing" | "failed"; createdAt: number; items: Array<{ productId: string; quantity: number; unitPrice: number }>; }
export interface AgentActivity { id: string; timestamp: number; tool: string; purpose: string; state: "running" | "complete" | "failed"; summary: string; }
export interface SimulationSnapshot { epoch: number; causalRevision: number; observabilityRevision: number; virtualNow: number; scenario: ScenarioId; scenarioLabel: string; services: ServiceRuntime[]; health: ServiceHealth[]; activeIncident: Incident; incidents: Incident[]; deployments: Deployment[]; proposals: Proposal[]; executions: Execution[]; verifications: Verification[]; receipts: Receipt[]; agentActivity: AgentActivity[]; products: Product[]; }

export const parseToolInput = <T>(input: unknown, schema: z.ZodType<T>): T => {
  const normalized = typeof input === "string" ? JSON.parse(input) as unknown : input;
  return schema.parse(normalized);
};
