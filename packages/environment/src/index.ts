import type {
  ActionType,
  AgentActivity,
  Approval,
  Cart,
  DeployCheckoutRevisionInput,
  DeployCheckoutRevisionResult,
  Deployment,
  DependencyEdge,
  Execution,
  Incident,
  LogEvent,
  MetricPoint,
  OperationalStatus,
  Order,
  Product,
  Proposal,
  ProposalInput,
  Receipt,
  RecoveryAction,
  ScenarioId,
  ServiceHealth,
  ServiceId,
  ServiceRuntime,
  EnvironmentSnapshot,
  Verification,
  VerificationOutcome,
} from "@seigyo/contracts";

type IdempotencyRecord = { fingerprint: string; result: unknown };
type UndoSnapshot = {
  version: string;
  previousVersion: string;
  replicas: number;
  enabled: boolean;
  restartUntil: number | null;
  featureFlags: Record<string, boolean>;
  provider?: "primary" | "fallback";
};
export interface EnvironmentState {
  seed: string;
  epoch: number;
  causalRevision: number;
  observabilityRevision: number;
  virtualNow: number;
  scenario: ScenarioId;
  primaryProviderAvailable: boolean;
  inventoryDemandBoost: number;
  services: Record<ServiceId, ServiceRuntime>;
  incidents: Incident[];
  deployments: Deployment[];
  metrics: MetricPoint[];
  logs: LogEvent[];
  proposals: Proposal[];
  approvals: Approval[];
  executions: Execution[];
  verifications: Verification[];
  receipts: Receipt[];
  agentActivity: AgentActivity[];
  products: Product[];
  carts: Record<string, Cart>;
  orders: Order[];
  idempotency: Record<string, IdempotencyRecord>;
  undoSnapshots: Record<string, UndoSnapshot>;
}

const base = {
  "storefront-edge": { demand: 100, capacity: 800, p95: 120, error: 0.0004 },
  "catalog-api": { demand: 45, capacity: 160, p95: 180, error: 0.0006 },
  "cart-api": { demand: 12, capacity: 80, p95: 220, error: 0.0007 },
  "checkout-api": { demand: 10, capacity: 60, p95: 420, error: 0.0008 },
  "payment-gateway": { demand: 9, capacity: 45, p95: 480, error: 0.0009 },
  "inventory-db": { demand: 130, capacity: 100, p95: 90, error: 0.0004 },
  "order-worker": { demand: 8, capacity: 25, p95: 700, error: 0.0008 },
} satisfies Record<
  ServiceId,
  { demand: number; capacity: number; p95: number; error: number }
>;

const healthObjectives: Record<
  ServiceId,
  { errorRate: number; p95Ms: number }
> = {
  "storefront-edge": { errorRate: 0.01, p95Ms: 700 },
  "catalog-api": { errorRate: 0.01, p95Ms: 600 },
  "cart-api": { errorRate: 0.01, p95Ms: 700 },
  "checkout-api": { errorRate: 0.005, p95Ms: 1200 },
  "payment-gateway": { errorRate: 0.005, p95Ms: 1200 },
  "inventory-db": { errorRate: 0.005, p95Ms: 400 },
  "order-worker": { errorRate: 0.01, p95Ms: 1200 },
};

const serviceStatus = (
  serviceId: ServiceId,
  enabled: boolean,
  errorRate: number,
  p95Ms: number,
): ServiceHealth["status"] => {
  if (!enabled) return "maintenance";
  if (errorRate > 0.2) return "critical";
  const objective = healthObjectives[serviceId];
  return errorRate > objective.errorRate || p95Ms > objective.p95Ms
    ? "degraded"
    : "healthy";
};

export const dependencyEdges: DependencyEdge[] = [
  { from: "storefront-edge", to: "catalog-api", weight: 0.24 },
  { from: "storefront-edge", to: "cart-api", weight: 0.12 },
  { from: "storefront-edge", to: "checkout-api", weight: 0.1 },
  { from: "catalog-api", to: "inventory-db", weight: 0.35 },
  { from: "cart-api", to: "inventory-db", weight: 0.28 },
  { from: "checkout-api", to: "inventory-db", weight: 0.2 },
  { from: "checkout-api", to: "payment-gateway", weight: 0.65 },
  { from: "checkout-api", to: "order-worker", weight: 0.08 },
  { from: "order-worker", to: "inventory-db", weight: 0.12 },
];

const dependencies = Object.fromEntries(
  (Object.keys(base) as ServiceId[]).map((serviceId) => [
    serviceId,
    dependencyEdges
      .filter((edge) => edge.from === serviceId)
      .map((edge) => ({ id: edge.to, weight: edge.weight })),
  ]),
) as Record<ServiceId, Array<{ id: ServiceId; weight: number }>>;

const names: Record<ServiceId, [string, string]> = {
  "storefront-edge": ["Storefront edge", "Web Platform"],
  "catalog-api": ["Catalog API", "Commerce Core"],
  "cart-api": ["Cart API", "Commerce Core"],
  "checkout-api": ["Checkout API", "Revenue Systems"],
  "payment-gateway": ["Payment gateway", "Revenue Systems"],
  "inventory-db": ["Inventory database", "Data Platform"],
  "order-worker": ["Order worker", "Fulfillment"],
};

const hosting: Record<ServiceId, ServiceRuntime["hosting"]> = {
  "storefront-edge": {
    providerId: "cloudflare",
    providerName: "Cloudflare",
    product: "Workers",
    region: "Global",
    resourceId: "myshop-edge-prod",
  },
  "catalog-api": {
    providerId: "render",
    providerName: "Render",
    product: "Web Service",
    region: "Frankfurt",
    resourceId: "catalog-api-prod",
  },
  "cart-api": {
    providerId: "render",
    providerName: "Render",
    product: "Web Service",
    region: "Frankfurt",
    resourceId: "cart-api-prod",
  },
  "checkout-api": {
    providerId: "render",
    providerName: "Render",
    product: "Web Service",
    region: "Frankfurt",
    resourceId: "checkout-api-prod",
  },
  "payment-gateway": {
    providerId: "stripe",
    providerName: "Stripe",
    product: "Payments",
    region: "Global",
    resourceId: "stripe-primary",
  },
  "inventory-db": {
    providerId: "supabase",
    providerName: "Supabase",
    product: "PostgreSQL",
    region: "Frankfurt",
    resourceId: "inventory-prod-eu",
  },
  "order-worker": {
    providerId: "render",
    providerName: "Render",
    product: "Background Worker",
    region: "Frankfurt",
    resourceId: "order-worker-prod",
  },
};

export const hash01 = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
};

const shortHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const sha256 = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    );
  });

const round = (value: number, precision = 3): number =>
  Number(value.toFixed(precision));
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
const id = (prefix: string, number: number): string =>
  `${prefix}-${String(number).padStart(3, "0")}`;
const scopedId = (prefix: string, epoch: number, number: number): string =>
  `${prefix}-${epoch}-${String(number).padStart(3, "0")}`;

const createServices = (): Record<ServiceId, ServiceRuntime> =>
  Object.fromEntries(
    (Object.keys(base) as ServiceId[]).map((serviceId) => {
      const [name, owner] = names[serviceId];
      const version =
        serviceId === "checkout-api"
          ? "checkout-2026.08.30.4"
          : `${serviceId}-2026.08.29.3`;
      return [
        serviceId,
        {
          id: serviceId,
          name,
          owner,
          version,
          previousVersion:
            serviceId === "checkout-api"
              ? "checkout-2026.08.29.7"
              : `${serviceId}-2026.08.29.2`,
          replicas: serviceId === "inventory-db" ? 2 : 1,
          minReplicas: 1,
          maxReplicas: 8,
          enabled: true,
          restartUntil: null,
          featureFlags:
            serviceId === "checkout-api" ? { "new-tax-rounding": true } : {},
          hosting: hosting[serviceId],
          ...(serviceId === "payment-gateway"
            ? { provider: "primary" as const }
            : {}),
        },
      ];
    }),
  ) as Record<ServiceId, ServiceRuntime>;

const productSpecs: Array<
  [string, Product["category"], string, number, string]
> = [
  [
    "Kuro lounge chair",
    "Furniture",
    "Blackened oak and cane",
    1180,
    "oak-chair.png",
  ],
  [
    "Fold paper pendant",
    "Lighting",
    "Handmade washi paper",
    620,
    "paper-pendant.png",
  ],
  ["Umber vessel", "Ceramics", "Mineral clay", 185, "umber-vessel.png"],
  [
    "Axis side table",
    "Furniture",
    "Honed travertine",
    790,
    "hero-living-room.png",
  ],
  ["Lowline bench", "Furniture", "Smoked oak", 940, "oak-chair.png"],
  [
    "Halo floor lamp",
    "Lighting",
    "Paper and blackened steel",
    860,
    "paper-pendant.png",
  ],
  ["Still bowl", "Ceramics", "Speckled stoneware", 140, "umber-vessel.png"],
  [
    "Grid wool throw",
    "Textiles",
    "Brushed merino wool",
    260,
    "hero-living-room.png",
  ],
  ["Arc dining chair", "Furniture", "Oak and woven rush", 540, "oak-chair.png"],
  ["Orbit pendant", "Lighting", "Layered paper", 710, "paper-pendant.png"],
  ["Quiet carafe", "Ceramics", "Glazed stoneware", 165, "umber-vessel.png"],
  [
    "Linen field cushion",
    "Textiles",
    "Washed Belgian linen",
    120,
    "hero-living-room.png",
  ],
  ["Monolith stool", "Furniture", "Solid ash", 420, "oak-chair.png"],
  ["Veil table lamp", "Lighting", "Paper and oak", 390, "paper-pendant.png"],
  ["Earth cup set", "Ceramics", "Reduction-fired clay", 96, "umber-vessel.png"],
  [
    "Raw edge runner",
    "Textiles",
    "Handwoven flax",
    150,
    "hero-living-room.png",
  ],
  [
    "Plane coffee table",
    "Furniture",
    "Black steel and stone",
    890,
    "oak-chair.png",
  ],
  [
    "Moon wall light",
    "Lighting",
    "Plaster and brass",
    470,
    "paper-pendant.png",
  ],
  ["Dune platter", "Ceramics", "Sand stoneware", 210, "umber-vessel.png"],
  [
    "Soft grid blanket",
    "Textiles",
    "Wool and alpaca",
    320,
    "hero-living-room.png",
  ],
  ["Cut bookend pair", "Objects", "Honed limestone", 230, "umber-vessel.png"],
  ["Long tray", "Objects", "Blackened oak", 170, "oak-chair.png"],
  [
    "Paper study mobile",
    "Objects",
    "Paper and fine steel",
    280,
    "paper-pendant.png",
  ],
  [
    "Quiet hour candle",
    "Objects",
    "Beeswax and ceramic",
    78,
    "hero-living-room.png",
  ],
];

const createProducts = (): Product[] =>
  productSpecs.map((p, index) => ({
    id: id("PRD", index + 1),
    slug: p[0].toLowerCase().replaceAll(" ", "-"),
    name: p[0],
    category: p[1],
    material: p[2],
    description: `A considered ${p[0].toLowerCase()} designed around honest material, useful proportion, and a quiet presence in the room.`,
    price: p[3],
    inventory: 5 + ((index * 7) % 19),
    image: `/images/${p[4]}`,
    dimensions:
      index % 2 === 0 ? "W 68 x D 74 x H 71 cm" : "W 42 x D 42 x H 54 cm",
    featured: index < 8,
  }));

const scenarioInfo: Record<
  ScenarioId,
  {
    title: string;
    incidentId: string;
    serviceId: ServiceId;
    impact: string;
    cause: string;
    severity: Incident["severity"];
  }
> = {
  "checkout-regression": {
    title: "Checkout errors after deployment",
    incidentId: "INC-042",
    serviceId: "checkout-api",
    impact: "Customers receive validation failures during checkout.",
    cause: "checkout-2026.08.30.4 with new-tax-rounding enabled",
    severity: "critical",
  },
  "payment-outage": {
    title: "Primary payment provider unavailable",
    incidentId: "INC-043",
    serviceId: "payment-gateway",
    impact: "Payment authorizations are timing out across checkout.",
    cause: "External primary provider outage",
    severity: "critical",
  },
  "inventory-saturation": {
    title: "Inventory database saturation",
    incidentId: "INC-044",
    serviceId: "inventory-db",
    impact: "Product availability and reservations are delayed.",
    cause: "Inventory demand exceeds provisioned capacity",
    severity: "high",
  },
};

const createIncidents = (scenario: ScenarioId, now: number): Incident[] => {
  const active = scenarioInfo[scenario];
  const history = Array.from(
    { length: 29 },
    (_, index): Incident => ({
      id: id("INC", index + 1),
      title:
        [
          "Elevated catalog latency",
          "Order worker retry spike",
          "Cart cache churn",
          "Edge origin timeout",
        ][index % 4] ?? "Historical incident",
      severity: (["low", "medium", "high"] as const)[index % 3] ?? "low",
      status: "resolved",
      serviceId:
        (Object.keys(base) as ServiceId[])[index % 7] ?? "storefront-edge",
      startedAt: now - (index + 3) * 86_400_000,
      updatedAt: now - (index + 3) * 86_400_000 + 2_400_000,
      resolvedAt: now - (index + 3) * 86_400_000 + 2_400_000,
      impact:
        "A bounded production degradation affected a subset of customer requests.",
      customerErrorsPerMinute: 12 + index,
      ordersAtRisk: 2 + (index % 8),
      cause: "Resolved historical operating condition",
    }),
  );
  return [
    {
      id: active.incidentId,
      title: active.title,
      severity: active.severity,
      status: "investigating",
      serviceId: active.serviceId,
      startedAt: now - 21 * 60_000,
      updatedAt: now,
      impact: active.impact,
      customerErrorsPerMinute:
        scenario === "payment-outage"
          ? 542
          : scenario === "checkout-regression"
            ? 186
            : 94,
      ordersAtRisk:
        scenario === "payment-outage"
          ? 88
          : scenario === "checkout-regression"
            ? 42
            : 27,
      cause: active.cause,
    },
    ...history,
  ];
};

const createDeployments = (now: number): Deployment[] =>
  Array.from({ length: 60 }, (_, index) => {
    const serviceId =
      (Object.keys(base) as ServiceId[])[index % 7] ?? "storefront-edge";
    const isRegression = index === 0;
    return {
      id: id("DEP", 160 - index),
      serviceId: isRegression ? "checkout-api" : serviceId,
      version: isRegression
        ? "checkout-2026.08.30.4"
        : `${serviceId}-2026.08.${String(29 - (index % 20)).padStart(2, "0")}.${index % 6}`,
      previousVersion: isRegression
        ? "checkout-2026.08.29.7"
        : `${serviceId}-2026.08.20.2`,
      status: "success",
      actor:
        ["Maya Chen", "Randy B.", "Release Bot", "Idris Cole"][index % 4] ??
        "Release Bot",
      commitSha: shortHash(`commit-${index}`),
      createdAt: isRegression
        ? now - 28 * 60_000
        : now - (index + 2) * 5_400_000,
      summary: isRegression
        ? "Tax rounding and checkout validation changes"
        : "Routine reliability and dependency update",
    };
  });

export const seedEnvironment = (
  scenario: ScenarioId = "checkout-regression",
  epoch = 1,
  initialState: "incident" | "operational" = "incident",
): EnvironmentState => {
  const now = Date.UTC(2026, 8, 1, 13, 20, 0);
  const state: EnvironmentState = {
    seed: `seigyo-${scenario}`,
    epoch,
    causalRevision: 1,
    observabilityRevision: 1,
    virtualNow: now,
    scenario,
    primaryProviderAvailable: scenario !== "payment-outage",
    inventoryDemandBoost: scenario === "inventory-saturation" ? 130 : 0,
    services: createServices(),
    incidents: createIncidents(scenario, now),
    deployments: createDeployments(now),
    metrics: [],
    logs: [],
    proposals: [],
    approvals: [],
    executions: [],
    verifications: [],
    receipts: [],
    agentActivity: [],
    products: createProducts(),
    carts: Object.create(null) as Record<string, Cart>,
    orders: [],
    idempotency: Object.create(null) as Record<string, IdempotencyRecord>,
    undoSnapshots: Object.create(null) as Record<string, UndoSnapshot>,
  };
  if (scenario !== "checkout-regression" || initialState === "operational") {
    state.services["checkout-api"].version = "checkout-2026.08.29.7";
    state.services["checkout-api"].featureFlags["new-tax-rounding"] = false;
  }
  if (initialState === "operational") {
    const initialIncident = state.incidents.find(
      (incident) => incident.status !== "resolved",
    );
    if (initialIncident) {
      initialIncident.status = "resolved";
      initialIncident.updatedAt = now;
      initialIncident.resolvedAt = now;
      initialIncident.customerErrorsPerMinute = 0;
      initialIncident.ordersAtRisk = 0;
    }
  }
  for (let tick = 720; tick > 0; tick -= 1) {
    const timestamp = now - tick * 60_000;
    const health = computeHealth(state, timestamp);
    state.metrics.push(
      ...health.map((point) => ({
        ...point,
        timestamp,
        p50Ms: round(point.p95Ms * 0.43, 1),
        cpuPct: round(
          clamp(
            point.utilization * 62 +
              hash01(`${state.seed}:${timestamp}:${point.serviceId}`) * 8,
            2,
            99,
          ),
          1,
        ),
      })),
    );
  }
  const levels = ["info", "info", "debug", "warn", "error"] as const;
  for (let index = 0; index < 1500; index += 1) {
    const serviceId =
      (Object.keys(base) as ServiceId[])[index % 7] ?? "storefront-edge";
    const timestamp = now - (1500 - index) * 18_000;
    const level = levels[(index * 7) % levels.length] ?? "info";
    state.logs.push({
      id: id("LOG", index + 1),
      timestamp,
      serviceId,
      level,
      eventName:
        level === "error"
          ? "request.failed"
          : level === "warn"
            ? "latency.threshold"
            : "request.completed",
      message:
        level === "error"
          ? `${serviceId} request failed after dependency response`
          : level === "warn"
            ? `${serviceId} p95 latency crossed the warning threshold`
            : `${serviceId} completed request`,
      traceId: `tr_${shortHash(`${index}:trace`)}`,
      requestId: `req_${shortHash(`${index}:request`)}`,
      metadata: {
        durationMs: 42 + ((index * 17) % 1800),
        attempt: 1 + (index % 3),
      },
    });
  }
  return state;
};

export const seedHealthyEnvironment = (epoch = 1): EnvironmentState =>
  seedEnvironment("checkout-regression", epoch, "operational");

const directHealth = (
  state: EnvironmentState,
  serviceId: ServiceId,
  timestamp: number,
): ServiceHealth => {
  const service = state.services[serviceId];
  const config = base[serviceId];
  const restarting =
    service.restartUntil !== null && service.restartUntil > timestamp;
  let demand = config.demand;
  if (serviceId === "inventory-db") demand += state.inventoryDemandBoost;
  const providerCapacityFactor =
    serviceId === "payment-gateway" && service.provider === "fallback"
      ? 0.7
      : 1;
  const capacity = config.capacity * service.replicas * providerCapacityFactor;
  const utilization = demand / capacity;
  let faultError = 0;
  let faultLatency = 0;
  if (
    state.scenario === "checkout-regression" &&
    serviceId === "checkout-api" &&
    service.featureFlags["new-tax-rounding"]
  ) {
    faultError = 0.17;
    faultLatency = 700;
  }
  if (
    serviceId === "payment-gateway" &&
    service.provider === "primary" &&
    !state.primaryProviderAvailable
  ) {
    faultError = 0.982;
    faultLatency = 3000;
  }
  if (serviceId === "payment-gateway" && service.provider === "fallback") {
    faultError = 0.001;
    faultLatency = 30;
  }
  const queueMs = Math.max(0, (utilization - 0.65) * 500);
  const saturationPenalty = Math.max(0, utilization - 1) * 0.35;
  const restartError = restarting ? 0.95 : 0;
  const maintenanceError = service.enabled ? 0 : 0.99;
  const noise =
    (hash01(`${state.seed}:${state.epoch}:${timestamp}:${serviceId}`) - 0.5) *
    0.0008;
  const errorRate = clamp(
    config.error +
      saturationPenalty +
      faultError +
      restartError +
      maintenanceError +
      noise,
    0,
    0.99,
  );
  const p95Ms = Math.min(
    30000,
    config.p95 + queueMs + faultLatency + Math.abs(noise) * 1000,
  );
  return {
    serviceId,
    status: serviceStatus(serviceId, service.enabled, errorRate, p95Ms),
    requestRate: round(demand, 1),
    errorRate: round(errorRate, 4),
    p95Ms: round(p95Ms, 1),
    queueDepth: Math.round(Math.max(0, utilization - 0.65) * 42),
    utilization: round(utilization, 3),
    availability: round(1 - errorRate, 4),
  };
};

export const computeHealth = (
  state: EnvironmentState,
  timestamp = state.virtualNow,
): ServiceHealth[] => {
  const order: ServiceId[] = [
    "inventory-db",
    "payment-gateway",
    "order-worker",
    "catalog-api",
    "cart-api",
    "checkout-api",
    "storefront-edge",
  ];
  const map = new Map<ServiceId, ServiceHealth>();
  for (const serviceId of order) {
    const own = directHealth(state, serviceId, timestamp);
    const dependencyError = dependencies[serviceId].reduce(
      (sum, dependency) =>
        sum + (map.get(dependency.id)?.errorRate ?? 0) * dependency.weight,
      0,
    );
    const dependencyLatency = dependencies[serviceId].reduce(
      (sum, dependency) =>
        sum + (map.get(dependency.id)?.p95Ms ?? 0) * dependency.weight,
      0,
    );
    const errorRate = clamp(own.errorRate + dependencyError, 0, 0.99);
    const p95Ms = Math.min(30000, own.p95Ms + dependencyLatency);
    map.set(serviceId, {
      ...own,
      errorRate: round(errorRate, 4),
      availability: round(1 - errorRate, 4),
      p95Ms: round(p95Ms, 1),
      status: serviceStatus(
        serviceId,
        state.services[serviceId].enabled,
        errorRate,
        p95Ms,
      ),
    });
  }
  return (Object.keys(base) as ServiceId[]).map(
    (serviceId) => map.get(serviceId) as ServiceHealth,
  );
};

const scenarioLabel = (scenario: ScenarioId): string =>
  ({
    "checkout-regression": "Checkout deployment regression",
    "payment-outage": "Payment provider outage",
    "inventory-saturation": "Inventory saturation",
  })[scenario];
const checkoutPath: ServiceId[] = [
  "checkout-api",
  "payment-gateway",
  "inventory-db",
  "order-worker",
];

export const isCustomerPathRecovered = (health: ServiceHealth[]): boolean => {
  const byService = new Map(health.map((item) => [item.serviceId, item]));
  const checkout = byService.get("checkout-api");
  return Boolean(
    checkout &&
      checkout.errorRate <= healthObjectives["checkout-api"].errorRate &&
      checkoutPath.every(
        (serviceId) => byService.get(serviceId)?.status === "healthy",
      ),
  );
};

export const deriveOperationalStatus = (
  state: EnvironmentState,
  health = computeHealth(state),
): OperationalStatus => {
  const activeIncident = state.incidents.find(
    (item) => item.status !== "resolved",
  );
  const impairedServiceCount = health.filter(
    (item) => item.status !== "healthy",
  ).length;
  const statusByIncident: Partial<
    Record<Incident["status"], OperationalStatus["state"]>
  > = {
    open: "incident",
    investigating: "investigating",
    identified: "incident",
    mitigating: "mitigating",
    monitoring: "recovering",
  };
  const stateName = activeIncident
    ? (statusByIncident[activeIncident.status] ?? "incident")
    : impairedServiceCount > 0
      ? "degraded"
      : "operational";
  const labels: Record<OperationalStatus["state"], string> = {
    incident: "Incident in progress",
    investigating: "Investigating",
    mitigating: "Mitigating",
    recovering: "Recovery monitoring",
    degraded: "Degraded performance",
    operational: "All systems operational",
  };
  const checkout = health.find((item) => item.serviceId === "checkout-api");
  return {
    state: stateName,
    label: labels[stateName],
    openIncidentCount: state.incidents.filter(
      (item) => item.status !== "resolved",
    ).length,
    impairedServiceCount,
    customerErrorsPerMinute:
      activeIncident?.customerErrorsPerMinute ??
      Math.round(
        (checkout?.errorRate ?? 0) * (checkout?.requestRate ?? 0) * 60,
      ),
    ordersAtRisk: activeIncident?.ordersAtRisk ?? 0,
    updatedAt: activeIncident?.updatedAt ?? state.virtualNow,
    ...(activeIncident ? { incidentId: activeIncident.id } : {}),
  };
};

export const snapshot = (state: EnvironmentState): EnvironmentSnapshot => {
  const health = computeHealth(state);
  return {
    epoch: state.epoch,
    causalRevision: state.causalRevision,
    observabilityRevision: state.observabilityRevision,
    virtualNow: state.virtualNow,
    scenario: state.scenario,
    scenarioLabel: scenarioLabel(state.scenario),
    services: Object.values(state.services),
    health,
    activeIncident:
      state.incidents.find((item) => item.status !== "resolved") ?? null,
    operationalStatus: deriveOperationalStatus(state, health),
    dependencyEdges,
    incidents: state.incidents,
    deployments: state.deployments.slice(0, 60),
    proposals: state.proposals.slice(-20).reverse(),
    executions: state.executions.slice(-20).reverse(),
    verifications: state.verifications.slice(-20).reverse(),
    receipts: state.receipts.slice(-30).reverse(),
    agentActivity: state.agentActivity.slice(-40).reverse(),
    products: state.products,
  };
};

export const tick = (
  state: EnvironmentState,
  seconds = 30,
): EnvironmentState => {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600)
    throw new Error(
      "INVALID_ARGUMENT:Tick duration must be from 0 to 3600 seconds.",
    );
  state.virtualNow += seconds * 1000;
  state.observabilityRevision += 1;
  const health = computeHealth(state);
  state.metrics.push(
    ...health.map((point) => ({
      ...point,
      timestamp: state.virtualNow,
      p50Ms: round(point.p95Ms * 0.43, 1),
      cpuPct: round(
        clamp(
          point.utilization * 62 +
            hash01(`${state.seed}:${state.virtualNow}:${point.serviceId}`) * 8,
          2,
          99,
        ),
        1,
      ),
    })),
  );
  if (state.metrics.length > 6000)
    state.metrics.splice(0, state.metrics.length - 6000);
  const worst = [...health].sort((a, b) => b.errorRate - a.errorRate)[0];
  if (worst)
    state.logs.push({
      id: id("LOG", state.logs.length + 1),
      timestamp: state.virtualNow,
      serviceId: worst.serviceId,
      level:
        worst.errorRate > 0.1
          ? "error"
          : worst.errorRate > 0.02
            ? "warn"
            : "info",
      eventName: worst.errorRate > 0.1 ? "request.failed" : "health.sample",
      message:
        worst.errorRate > 0.1
          ? `${worst.serviceId} observed elevated request failures`
          : `${worst.serviceId} health sample recorded`,
      traceId: `tr_${shortHash(`${state.virtualNow}:trace`)}`,
      metadata: { errorRate: worst.errorRate, p95Ms: worst.p95Ms },
    });
  if (state.logs.length > 1800) state.logs.splice(0, state.logs.length - 1800);
  return state;
};

const stateFingerprint = async (state: EnvironmentState): Promise<string> =>
  sha256(
    canonical({
      epoch: state.epoch,
      causalRevision: state.causalRevision,
      scenario: state.scenario,
      provider: state.services["payment-gateway"].provider,
      primaryProviderAvailable: state.primaryProviderAvailable,
      inventoryDemandBoost: state.inventoryDemandBoost,
      services: Object.values(state.services).map((service) => ({
        id: service.id,
        version: service.version,
        replicas: service.replicas,
        enabled: service.enabled,
        restartUntil: service.restartUntil,
        featureFlags: service.featureFlags,
        provider: service.provider,
      })),
    }),
  );
const actionFingerprint = async (action: RecoveryAction): Promise<string> =>
  sha256(canonical(action));
const recordActivity = (
  state: EnvironmentState,
  tool: string,
  purpose: string,
  summary: string,
  activityState: AgentActivity["state"] = "complete",
): void => {
  state.agentActivity.push({
    id: id("ACT", state.agentActivity.length + 1),
    timestamp: state.virtualNow,
    tool,
    purpose,
    state: activityState,
    summary,
  });
};

const isCorrectAction = (
  state: EnvironmentState,
  action: RecoveryAction,
): "recovery" | "partial" | "containment" | "unlikely" => {
  if (
    action.type === "maintenance_mode" &&
    ["storefront-edge", "checkout-api"].includes(action.targetService)
  )
    return "containment";
  if (state.scenario === "checkout-regression") {
    if (
      action.targetService === "checkout-api" &&
      (action.type === "rollback_deployment" || action.type === "shift_traffic")
    )
      return "recovery";
    if (
      action.targetService === "checkout-api" &&
      action.type === "disable_feature"
    )
      return "partial";
  }
  if (
    state.scenario === "payment-outage" &&
    action.targetService === "payment-gateway" &&
    action.type === "shift_traffic"
  )
    return "recovery";
  if (
    state.scenario === "payment-outage" &&
    action.targetService === "payment-gateway" &&
    action.type === "switch_provider" &&
    action.parameters.provider === "fallback"
  )
    return "recovery";
  if (
    state.scenario === "inventory-saturation" &&
    action.targetService === "inventory-db" &&
    action.type === "scale_service"
  )
    return Number(action.parameters.replicas ?? 0) >= 4
      ? "recovery"
      : "partial";
  return "unlikely";
};

const validateAction = (
  state: EnvironmentState,
  action: RecoveryAction,
): string | null => {
  const service = state.services[action.targetService];
  if (!service) return "Target service does not exist.";
  if (
    action.type === "scale_service" &&
    (typeof action.parameters.replicas !== "number" ||
      !Number.isInteger(action.parameters.replicas) ||
      action.parameters.replicas < service.minReplicas ||
      action.parameters.replicas > service.maxReplicas)
  )
    return `Replicas must be an integer from ${service.minReplicas} to ${service.maxReplicas}.`;
  if (
    action.type === "disable_feature" &&
    (typeof action.parameters.feature !== "string" ||
      !action.parameters.feature.trim() ||
      !(action.parameters.feature in service.featureFlags))
  )
    return "A declared feature on the target service is required.";
  if (
    action.type === "switch_provider" &&
    (action.targetService !== "payment-gateway" ||
      !["primary", "fallback"].includes(String(action.parameters.provider)))
  )
    return "Provider switching requires payment-gateway and provider primary or fallback.";
  if (
    action.type === "shift_traffic" &&
    !["checkout-api", "payment-gateway"].includes(action.targetService)
  )
    return "Traffic shifting is supported only for checkout-api or payment-gateway.";
  if (
    action.type === "rollback_deployment" &&
    !state.deployments.some(
      (item) =>
        item.serviceId === action.targetService &&
        item.version === service.version &&
        item.status === "success",
    )
  )
    return "No current successful deployment can be rolled back on the target service.";
  return null;
};

const applyAction = (state: EnvironmentState, action: RecoveryAction): void => {
  const service = state.services[action.targetService];
  if (action.type === "rollback_deployment") {
    const current = service.version;
    const deployment = state.deployments.find(
      (item) => item.serviceId === service.id && item.version === current,
    );
    service.version = deployment?.previousVersion ?? service.previousVersion;
    service.previousVersion = current;
    if (deployment) deployment.status = "rolled_back";
    if (service.id === "checkout-api")
      service.featureFlags["new-tax-rounding"] = false;
  }
  if (action.type === "restart_service")
    service.restartUntil = state.virtualNow + 5000;
  if (action.type === "scale_service")
    service.replicas = action.parameters.replicas as number;
  if (action.type === "shift_traffic" && service.id === "checkout-api") {
    const deployment = state.deployments.find(
      (item) =>
        item.serviceId === service.id && item.version === service.version,
    );
    service.version = deployment?.previousVersion ?? service.previousVersion;
    if (deployment) deployment.status = "rolled_back";
    service.featureFlags["new-tax-rounding"] = false;
  }
  if (action.type === "shift_traffic" && service.id === "payment-gateway")
    service.provider = "fallback";
  if (action.type === "disable_feature")
    service.featureFlags[String(action.parameters.feature)] = false;
  if (action.type === "switch_provider")
    service.provider =
      action.parameters.provider === "primary" ? "primary" : "fallback";
  if (action.type === "maintenance_mode") service.enabled = false;
};

export const investigate = (state: EnvironmentState, incidentId: string) => {
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident) return null;
  if (incident.status === "investigating") incident.status = "identified";
  const health = computeHealth(state);
  const root = scenarioInfo[state.scenario];
  const currentCause =
    state.scenario === "checkout-regression" ? incident.cause : root.cause;
  const deployment = state.deployments.find(
    (item) => item.serviceId === root.serviceId,
  );
  const result = {
    incident,
    summary: `${root.serviceId} is the highest-confidence causal source for the active customer impact.`,
    hypotheses: [
      {
        id: "H1",
        statement: currentCause,
        confidence: 0.92,
        evidenceRefs: [
          `metric:${root.serviceId}`,
          deployment ? `deployment:${deployment.id}` : `logs:${root.serviceId}`,
        ],
      },
      {
        id: "H2",
        statement: "A downstream dependency is amplifying retry pressure.",
        confidence: 0.48,
        evidenceRefs: ["dependency:checkout-path"],
      },
    ],
    signals: health
      .filter((item) => item.status !== "healthy")
      .map((item) => ({
        kind: "metric",
        sourceRef: `metric:${item.serviceId}`,
        observedAt: state.virtualNow,
        detail: `${item.serviceId} error ${round(item.errorRate * 100, 2)}%, p95 ${item.p95Ms} ms`,
      })),
    nextBestActions:
      state.scenario === "checkout-regression"
        ? [
            {
              actionType: "rollback_deployment",
              targetService: "checkout-api",
              reason:
                "The error increase follows the current checkout deployment.",
            },
          ]
        : state.scenario === "payment-outage"
          ? [
              {
                actionType: "switch_provider",
                targetService: "payment-gateway",
                reason:
                  "The primary provider is unavailable while the fallback remains healthy.",
              },
            ]
          : [
              {
                actionType: "scale_service",
                targetService: "inventory-db",
                reason: "Demand exceeds provisioned database capacity.",
              },
            ],
    staleAt: state.virtualNow + 5 * 60_000,
  };
  recordActivity(
    state,
    "seigyo.investigate_incident",
    "Correlate metrics, logs, deployments, and dependencies",
    `Identified ${root.serviceId} as the leading cause.`,
  );
  return result;
};

export const proposeAction = async (
  state: EnvironmentState,
  input: ProposalInput,
): Promise<Proposal> => {
  validatePublicKey(input.idempotencyKey, "idempotencyKey");
  const duplicate = Object.hasOwn(state.idempotency, input.idempotencyKey)
    ? state.idempotency[input.idempotencyKey]
    : undefined;
  const fingerprint = await sha256(canonical(input));
  if (duplicate) {
    if (duplicate.fingerprint !== fingerprint)
      throw new Error("IDEMPOTENCY_CONFLICT");
    return duplicate.result as Proposal;
  }
  const incident = state.incidents.find((item) => item.id === input.incidentId);
  if (!incident) throw new Error("NOT_FOUND:Incident does not exist.");
  if (incident.status === "resolved")
    throw new Error(
      "PRECONDITION_FAILED:Resolved incidents cannot accept new interventions.",
    );
  if (input.evidenceRefs.length < 1)
    throw new Error(
      "PRECONDITION_FAILED:At least one evidence reference is required.",
    );
  const evidenceIsValid = (reference: string): boolean => {
    const [kind, value] = reference.split(":", 2);
    if (!kind || !value) return false;
    if (kind === "deployment")
      return state.deployments.some((item) => item.id === value);
    if (kind === "metric" || kind === "logs") return value in state.services;
    if (kind === "dependency")
      return value === "checkout-path" || value in state.services;
    return false;
  };
  if (!input.evidenceRefs.every(evidenceIsValid))
    throw new Error(
      "INVALID_ARGUMENT:One or more evidence references are invalid.",
    );
  const validationError = validateAction(state, input.action);
  if (validationError) throw new Error(`INVALID_ACTION:${validationError}`);
  const classification = isCorrectAction(state, input.action);
  const current =
    computeHealth(state).find(
      (item) => item.serviceId === input.action.targetService,
    ) ?? (computeHealth(state)[0] as ServiceHealth);
  const projected = structuredClone(state);
  applyAction(projected, input.action);
  const projectedHealth =
    computeHealth(projected).find(
      (item) => item.serviceId === input.action.targetService,
    ) ?? current;
  const proposal: Proposal = {
    id: id("PROP", state.proposals.length + 1),
    incidentId: input.incidentId,
    epoch: state.epoch,
    causalRevision: state.causalRevision,
    action: input.action,
    actionHash: await actionFingerprint(input.action),
    rationale: input.rationale,
    evidenceRefs: input.evidenceRefs,
    status: "pending",
    expiresAt: state.virtualNow + 10 * 60_000,
    predictedImpact: {
      classification,
      risk:
        input.action.type === "maintenance_mode"
          ? "high"
          : input.action.type === "restart_service"
            ? "medium"
            : "low",
      summary:
        classification === "recovery"
          ? "Expected to remove the modeled root condition."
          : classification === "partial"
            ? "Expected to improve the incident without fully removing the cause."
            : classification === "containment"
              ? "Stops customer traffic but does not restore service."
              : "Changes service state but is unlikely to remove the current cause.",
      expectedErrorRate: round(projectedHealth.errorRate, 4),
      expectedP95Ms: projectedHealth.p95Ms,
      reversible: input.action.type !== "maintenance_mode",
    },
  };
  state.proposals.push(proposal);
  state.idempotency[input.idempotencyKey] = { fingerprint, result: proposal };
  recordActivity(
    state,
    "seigyo.propose_action",
    "Create a reviewable intervention",
    `${input.action.type} proposed for ${input.action.targetService}.`,
  );
  return proposal;
};

export const approveProposal = async (
  state: EnvironmentState,
  proposalId: string,
  sessionId: string,
): Promise<Approval> => {
  validatePublicKey(sessionId, "sessionId");
  const proposal = state.proposals.find((item) => item.id === proposalId);
  if (!proposal) throw new Error("NOT_FOUND");
  if (proposal.status !== "pending") throw new Error("PRECONDITION_FAILED");
  if (proposal.expiresAt <= state.virtualNow) {
    proposal.status = "expired";
    throw new Error("STALE_STATE");
  }
  if (
    proposal.epoch !== state.epoch ||
    proposal.causalRevision !== state.causalRevision
  ) {
    proposal.status = "stale";
    throw new Error("STALE_STATE");
  }
  const approval: Approval = {
    proposalId,
    sessionId,
    actionHash: proposal.actionHash,
    epoch: state.epoch,
    causalRevision: state.causalRevision,
    token: `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", ""),
    expiresAt: state.virtualNow + 5 * 60_000,
    used: false,
    approvedAt: state.virtualNow,
  };
  proposal.status = "approved";
  state.approvals.push(approval);
  return approval;
};

export const rejectProposal = (
  state: EnvironmentState,
  proposalId: string,
): Proposal => {
  const proposal = state.proposals.find((item) => item.id === proposalId);
  if (!proposal) throw new Error("NOT_FOUND");
  if (proposal.status !== "pending") throw new Error("PRECONDITION_FAILED");
  proposal.status = "rejected";
  return proposal;
};

export const executeProposal = async (
  state: EnvironmentState,
  proposalId: string,
  approvalToken: string,
  idempotencyKey: string,
  sessionId: string,
): Promise<Execution> => {
  validatePublicKey(idempotencyKey, "idempotencyKey");
  validatePublicKey(sessionId, "sessionId");
  const fingerprint = await sha256(
    canonical({ proposalId, approvalToken, sessionId }),
  );
  const duplicate = Object.hasOwn(state.idempotency, idempotencyKey)
    ? state.idempotency[idempotencyKey]
    : undefined;
  if (duplicate) {
    if (duplicate.fingerprint !== fingerprint)
      throw new Error("IDEMPOTENCY_CONFLICT");
    return duplicate.result as Execution;
  }
  const proposal = state.proposals.find((item) => item.id === proposalId);
  const approval = state.approvals.find(
    (item) => item.proposalId === proposalId && item.token === approvalToken,
  );
  if (!proposal) throw new Error("NOT_FOUND");
  if (proposal.status !== "approved")
    throw new Error(
      "PRECONDITION_FAILED:Proposal is not approved for execution.",
    );
  if (!approval || approval.used || approval.sessionId !== sessionId)
    throw new Error("APPROVAL_REQUIRED");
  if (
    proposal.expiresAt <= state.virtualNow ||
    approval.expiresAt <= state.virtualNow ||
    approval.epoch !== state.epoch ||
    approval.causalRevision !== state.causalRevision ||
    approval.actionHash !== proposal.actionHash
  ) {
    proposal.status =
      proposal.expiresAt <= state.virtualNow ? "expired" : "stale";
    throw new Error("STALE_STATE");
  }
  const beforeStateHash = await stateFingerprint(state);
  const executionRevision = state.causalRevision + 1;
  const execution: Execution = {
    id: scopedId("EXEC", state.epoch, state.executions.length + 1),
    proposalId,
    incidentId: proposal.incidentId,
    state: "running",
    action: proposal.action,
    startedAt: state.virtualNow,
    beforeStateHash,
    undoAvailable: proposal.predictedImpact.reversible,
    causalRevision: executionRevision,
  };
  state.executions.push(execution);
  state.undoSnapshots[execution.id] = {
    version: state.services[proposal.action.targetService].version,
    previousVersion:
      state.services[proposal.action.targetService].previousVersion,
    replicas: state.services[proposal.action.targetService].replicas,
    enabled: state.services[proposal.action.targetService].enabled,
    restartUntil: state.services[proposal.action.targetService].restartUntil,
    featureFlags: {
      ...state.services[proposal.action.targetService].featureFlags,
    },
    ...(state.services[proposal.action.targetService].provider
      ? { provider: state.services[proposal.action.targetService].provider }
      : {}),
  };
  proposal.status = "executing";
  const incident = state.incidents.find(
    (item) => item.id === proposal.incidentId,
  );
  if (incident) {
    incident.status = "mitigating";
    incident.updatedAt = state.virtualNow;
  }
  approval.used = true;
  applyAction(state, proposal.action);
  state.causalRevision = executionRevision;
  tick(
    state,
    (
      {
        rollback_deployment: 10,
        restart_service: 5,
        scale_service: 15,
        shift_traffic: 5,
        disable_feature: 2,
        switch_provider: 5,
        maintenance_mode: 1,
      } satisfies Record<ActionType, number>
    )[proposal.action.type],
  );
  execution.state = "succeeded";
  execution.finishedAt = state.virtualNow;
  execution.afterStateHash = await stateFingerprint(state);
  proposal.status = "succeeded";
  const previousReceiptHash = state.receipts.at(-1)?.receiptHash ?? "GENESIS";
  const receiptBase = {
    id: scopedId("RCP", state.epoch, state.receipts.length + 1),
    incidentId: proposal.incidentId,
    proposalId,
    executionId: execution.id,
    action: proposal.action,
    actionHash: proposal.actionHash,
    beforeStateHash,
    afterStateHash: execution.afterStateHash,
    evidenceRefs: proposal.evidenceRefs,
    approvedAt: approval.approvedAt,
    executedAt: execution.finishedAt,
    result: "pending" as const,
    previousReceiptHash,
    epoch: state.epoch,
  };
  state.receipts.push({
    ...receiptBase,
    receiptHash: await sha256(canonical(receiptBase)),
  });
  state.idempotency[idempotencyKey] = { fingerprint, result: execution };
  recordActivity(
    state,
    "seigyo.execute_action",
    "Execute the approved intervention",
    `${proposal.action.type} completed on ${proposal.action.targetService}.`,
  );
  return execution;
};

export const verifyExecution = async (
  state: EnvironmentState,
  executionId: string,
  incidentId: string,
): Promise<Verification> => {
  const execution = state.executions.find((item) => item.id === executionId);
  if (!execution || execution.incidentId !== incidentId)
    throw new Error("NOT_FOUND");
  const existing = state.verifications.find(
    (item) => item.executionId === executionId,
  );
  if (existing) return existing;
  const recoverySamples: ServiceHealth[][] = [];
  for (let sample = 0; sample < 3; sample += 1) {
    tick(state, 30);
    recoverySamples.push(computeHealth(state));
  }
  const health = recoverySamples.at(-1) as ServiceHealth[];
  const target = health.find(
    (item) => item.serviceId === execution.action.targetService,
  ) as ServiceHealth;
  const checkout = health.find(
    (item) => item.serviceId === "checkout-api",
  ) as ServiceHealth;
  const correct = isCorrectAction(state, execution.action);
  const recoveredForThreeSamples = recoverySamples.every(
    isCustomerPathRecovered,
  );
  let outcome: VerificationOutcome =
    correct === "containment"
      ? "contained"
      : correct === "partial"
        ? "partially_recovered"
        : correct === "recovery" && recoveredForThreeSamples
          ? "recovered"
          : target.errorRate > 0.2
            ? "unchanged"
            : "partially_recovered";
  if (execution.action.type === "restart_service" && target.errorRate > 0.5)
    outcome = "worsened";
  const verification: Verification = {
    id: scopedId("VER", state.epoch, state.verifications.length + 1),
    executionId,
    incidentId,
    outcome,
    verifiedAt: state.virtualNow,
    checks: [
      {
        name: "service_health",
        status: checkoutPath.every(
          (serviceId) =>
            health.find((item) => item.serviceId === serviceId)?.status ===
            "healthy",
        )
          ? "pass"
          : "fail",
        observed: `${health.filter((item) => checkoutPath.includes(item.serviceId) && item.status === "healthy").length}/${checkoutPath.length} customer-path services healthy`,
        expected: "all customer-path services healthy",
      },
      {
        name: "error_rate",
        status:
          checkout.errorRate <= healthObjectives["checkout-api"].errorRate
            ? "pass"
            : "fail",
        observed: `${round(checkout.errorRate * 100, 2)}%`,
        expected: "0.5% or lower",
      },
      {
        name: "latency",
        status:
          checkout.p95Ms <= healthObjectives["checkout-api"].p95Ms
            ? "pass"
            : "fail",
        observed: `${checkout.p95Ms} ms`,
        expected: `${healthObjectives["checkout-api"].p95Ms} ms or lower`,
      },
    ],
    residualRisk:
      outcome === "recovered"
        ? "Metrics have remained within recovery thresholds for three consecutive samples."
        : outcome === "contained"
          ? "Customer traffic is stopped, but the underlying fault remains."
          : "The root condition or dependency pressure remains active.",
  };
  state.verifications.push(verification);
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (incident) {
    incident.status =
      outcome === "recovered"
        ? "resolved"
        : outcome === "contained"
          ? "mitigating"
          : "monitoring";
    incident.updatedAt = state.virtualNow;
    if (outcome === "recovered") {
      incident.resolvedAt = state.virtualNow;
      incident.customerErrorsPerMinute = 0;
      incident.ordersAtRisk = 0;
    }
  }
  const receipt = state.receipts.find(
    (item) => item.executionId === executionId,
  );
  if (receipt) {
    receipt.verifiedAt = state.virtualNow;
    receipt.result = outcome;
    let previousReceiptHash = "GENESIS";
    for (const item of state.receipts) {
      item.previousReceiptHash = previousReceiptHash;
      item.receiptHash = await sha256(
        canonical({ ...item, receiptHash: undefined }),
      );
      previousReceiptHash = item.receiptHash;
    }
  }
  recordActivity(
    state,
    "seigyo.verify_action",
    "Measure the actual recovery result",
    `Verification result: ${outcome}.`,
  );
  return verification;
};

export const undoExecution = async (
  state: EnvironmentState,
  executionId: string,
  idempotencyKey: string,
): Promise<Execution> => {
  validatePublicKey(idempotencyKey, "idempotencyKey");
  const fingerprint = await sha256(
    canonical({ operation: "undo", executionId }),
  );
  const duplicate = Object.hasOwn(state.idempotency, idempotencyKey)
    ? state.idempotency[idempotencyKey]
    : undefined;
  if (duplicate) {
    if (duplicate.fingerprint !== fingerprint)
      throw new Error("IDEMPOTENCY_CONFLICT");
    return duplicate.result as Execution;
  }
  const original = state.executions.find((item) => item.id === executionId);
  if (!original) throw new Error("NOT_FOUND");
  if (!original.undoAvailable) throw new Error("IRREVERSIBLE");
  if (state.causalRevision !== original.causalRevision)
    throw new Error(
      "STALE_STATE:A newer causal change prevents restoring this snapshot.",
    );
  const saved = state.undoSnapshots[executionId];
  if (!saved)
    throw new Error("IRREVERSIBLE:Original service state is unavailable.");
  const beforeStateHash = await stateFingerprint(state);
  const service = state.services[original.action.targetService];
  service.version = saved.version;
  service.previousVersion = saved.previousVersion;
  service.replicas = saved.replicas;
  service.enabled = saved.enabled;
  service.restartUntil = saved.restartUntil;
  service.featureFlags = { ...saved.featureFlags };
  if (saved.provider) service.provider = saved.provider;
  original.undoAvailable = false;
  state.causalRevision += 1;
  tick(state, 10);
  const undo: Execution = {
    id: scopedId("EXEC", state.epoch, state.executions.length + 1),
    proposalId: original.proposalId,
    incidentId: original.incidentId,
    state: "succeeded",
    action: original.action,
    startedAt: state.virtualNow - 10_000,
    finishedAt: state.virtualNow,
    beforeStateHash,
    afterStateHash: await stateFingerprint(state),
    undoAvailable: false,
    causalRevision: state.causalRevision,
  };
  state.executions.push(undo);
  state.idempotency[idempotencyKey] = { fingerprint, result: undo };
  const originalReceipt = state.receipts.find(
    (item) => item.executionId === executionId,
  );
  const previousReceiptHash = state.receipts.at(-1)?.receiptHash ?? "GENESIS";
  const receiptBase = {
    id: scopedId("RCP", state.epoch, state.receipts.length + 1),
    incidentId: original.incidentId,
    proposalId: original.proposalId,
    executionId: undo.id,
    action: original.action,
    actionHash:
      originalReceipt?.actionHash ?? (await actionFingerprint(original.action)),
    beforeStateHash,
    afterStateHash: undo.afterStateHash as string,
    evidenceRefs: originalReceipt?.evidenceRefs ?? [],
    approvedAt: originalReceipt?.approvedAt ?? state.virtualNow,
    executedAt: state.virtualNow,
    result: "pending" as const,
    previousReceiptHash,
    epoch: state.epoch,
    undoOf: originalReceipt?.id,
  };
  state.receipts.push({
    ...receiptBase,
    receiptHash: await sha256(canonical(receiptBase)),
  });
  recordActivity(
    state,
    "seigyo.undo_action",
    "Restore the service state captured before execution",
    `Undid ${original.action.type} on ${original.action.targetService}.`,
  );
  return undo;
};

export const resetEnvironment = (
  state: EnvironmentState,
  scenario: ScenarioId,
): EnvironmentState => {
  const receipts = state.receipts;
  const next = seedEnvironment(scenario, state.epoch + 1);
  next.receipts = receipts;
  next.causalRevision = state.causalRevision + 1;
  next.observabilityRevision = state.observabilityRevision + 1;
  return next;
};

export const restoreHealthyEnvironment = (
  state: EnvironmentState,
): EnvironmentState => {
  const receipts = state.receipts;
  const next = seedHealthyEnvironment(state.epoch + 1);
  next.receipts = receipts;
  next.causalRevision = state.causalRevision + 1;
  next.observabilityRevision = state.observabilityRevision + 1;
  return next;
};

const nextNumericId = (items: Array<{ id: string }>, prefix: string): string => {
  const highest = items.reduce((maximum, item) => {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(item.id);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
  return id(prefix, highest + 1);
};

const nextCheckoutVersion = (state: EnvironmentState): string => {
  const date = new Date(state.virtualNow);
  const datePart = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join(".");
  const prefix = `checkout-${datePart}.`;
  const highestRevision = state.deployments.reduce((maximum, deployment) => {
    if (!deployment.version.startsWith(prefix)) return maximum;
    const revision = Number(deployment.version.slice(prefix.length));
    return Number.isInteger(revision) ? Math.max(maximum, revision) : maximum;
  }, 0);
  return `${prefix}${highestRevision + 1}`;
};

export const deployCheckoutRevision = async (
  state: EnvironmentState,
  input: DeployCheckoutRevisionInput,
): Promise<DeployCheckoutRevisionResult> => {
  validatePublicKey(input.idempotencyKey, "idempotencyKey");
  const fingerprint = await sha256(
    canonical({ operation: "deploy-checkout-revision", ...input }),
  );
  const duplicate = Object.hasOwn(state.idempotency, input.idempotencyKey)
    ? state.idempotency[input.idempotencyKey]
    : undefined;
  if (duplicate) {
    if (duplicate.fingerprint !== fingerprint)
      throw new Error("IDEMPOTENCY_CONFLICT");
    return structuredClone(duplicate.result) as DeployCheckoutRevisionResult;
  }

  const status = deriveOperationalStatus(state);
  if (
    status.state !== "operational" ||
    status.openIncidentCount > 0 ||
    state.deployments.some((deployment) => deployment.status === "in_progress")
  )
    throw new Error(
      "PRECONDITION_FAILED:A new checkout revision can be deployed only when all systems are operational.",
    );

  const checkoutService = state.services["checkout-api"];
  const previousVersion = checkoutService.version;
  const version = nextCheckoutVersion(state);
  const deployment: Deployment = {
    id: nextNumericId(state.deployments, "DEP"),
    serviceId: "checkout-api",
    version,
    previousVersion,
    status: "success",
    actor: "Randy B.",
    commitSha: shortHash(
      `${state.seed}:${state.epoch}:${state.causalRevision}:${version}`,
    ),
    createdAt: state.virtualNow,
    summary: "Checkout tax rounding and validation update",
  };
  const incident: Incident = {
    id: nextNumericId(state.incidents, "INC"),
    title: "Checkout errors after deployment",
    severity: "critical",
    status: "investigating",
    serviceId: "checkout-api",
    startedAt: state.virtualNow,
    updatedAt: state.virtualNow,
    impact: "Customers receive validation failures during checkout.",
    customerErrorsPerMinute: 186,
    ordersAtRisk: 42,
    cause: `${version} with new-tax-rounding enabled`,
  };

  for (const proposal of state.proposals) {
    if (proposal.status === "pending" || proposal.status === "approved")
      proposal.status = "stale";
  }
  state.scenario = "checkout-regression";
  checkoutService.previousVersion = previousVersion;
  checkoutService.version = version;
  checkoutService.featureFlags["new-tax-rounding"] = true;
  state.deployments.unshift(deployment);
  state.incidents.unshift(incident);
  state.causalRevision += 1;
  tick(state, 0);
  state.logs.push({
    id: nextNumericId(state.logs, "LOG"),
    timestamp: state.virtualNow,
    serviceId: "checkout-api",
    level: "error",
    eventName: "deployment.regression_detected",
    message: `${version} increased checkout validation failures`,
    traceId: `tr_${shortHash(`${version}:deployment`)}`,
    metadata: {
      deploymentId: deployment.id,
      version,
      errorRate:
        computeHealth(state).find((item) => item.serviceId === "checkout-api")
          ?.errorRate ?? 0,
    },
  });
  if (state.logs.length > 1800) state.logs.splice(0, state.logs.length - 1800);

  const result: DeployCheckoutRevisionResult = {
    deployment,
    incident,
    operationalStatus: deriveOperationalStatus(state),
    causalRevision: state.causalRevision,
  };
  state.idempotency[input.idempotencyKey] = {
    fingerprint,
    result: structuredClone(result),
  };
  return result;
};

const boundedLimit = (value: number, fallback: number, max: number): number =>
  Number.isFinite(value)
    ? Math.max(0, Math.min(Math.trunc(value), max))
    : fallback;
export const queryMetrics = (
  state: EnvironmentState,
  serviceId?: ServiceId,
  limit = 180,
): MetricPoint[] => {
  const count = boundedLimit(limit, 180, 300);
  return count === 0
    ? []
    : state.metrics
        .filter((point) => !serviceId || point.serviceId === serviceId)
        .slice(-count);
};
export const searchLogs = (
  state: EnvironmentState,
  serviceId?: ServiceId,
  query = "",
  limit = 50,
): LogEvent[] => {
  const count = boundedLimit(limit, 50, 50);
  return count === 0
    ? []
    : state.logs
        .filter(
          (log) =>
            (!serviceId || log.serviceId === serviceId) &&
            (!query ||
              `${log.message} ${log.eventName}`
                .toLowerCase()
                .includes(query.toLowerCase())),
        )
        .slice(-count)
        .reverse();
};

const validatePublicKey = (value: string, field: string): void => {
  if (
    !/^[a-zA-Z0-9_-]{1,100}$/.test(value) ||
    ["__proto__", "prototype", "constructor"].includes(value)
  )
    throw new Error(`INVALID_ARGUMENT:${field} is invalid.`);
};
export const getCart = (state: EnvironmentState, cartId: string): Cart => {
  validatePublicKey(cartId, "cartId");
  return Object.hasOwn(state.carts, cartId)
    ? (state.carts[cartId] as Cart)
    : { id: cartId, items: [], updatedAt: state.virtualNow };
};
export const updateCart = (
  state: EnvironmentState,
  cartId: string,
  productId: string,
  quantity: number,
): Cart => {
  validatePublicKey(cartId, "cartId");
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 10)
    throw new Error(
      "INVALID_ARGUMENT:Quantity must be an integer from 0 to 10.",
    );
  if (!state.products.some((product) => product.id === productId))
    throw new Error("NOT_FOUND");
  const cart = getCart(state, cartId);
  const existing = cart.items.find((item) => item.productId === productId);
  if (existing) existing.quantity = quantity;
  else if (quantity > 0) cart.items.push({ productId, quantity });
  cart.items = cart.items.filter((item) => item.quantity > 0);
  cart.updatedAt = state.virtualNow;
  state.carts[cartId] = cart;
  return cart;
};

export const checkout = async (
  state: EnvironmentState,
  input: {
    cartId: string;
    email: string;
    name: string;
    address: string;
    requestId: string;
    idempotencyKey: string;
  },
): Promise<Order> => {
  validatePublicKey(input.cartId, "cartId");
  validatePublicKey(input.idempotencyKey, "idempotencyKey");
  const fingerprint = await sha256(canonical(input));
  const duplicate = Object.hasOwn(state.idempotency, input.idempotencyKey)
    ? state.idempotency[input.idempotencyKey]
    : undefined;
  if (duplicate) {
    if (duplicate.fingerprint !== fingerprint)
      throw new Error("IDEMPOTENCY_CONFLICT");
    return duplicate.result as Order;
  }
  const cart = getCart(state, input.cartId);
  if (cart.items.length === 0)
    throw new Error("PRECONDITION_FAILED:Cart is empty.");
  const checkoutService = state.services["checkout-api"];
  if (!checkoutService.enabled)
    throw new Error(
      "UPSTREAM_UNAVAILABLE:Checkout is temporarily in maintenance mode.",
    );
  if (
    !["payment-gateway", "inventory-db", "order-worker"].every(
      (serviceId) => state.services[serviceId as ServiceId].enabled,
    )
  )
    throw new Error(
      "UPSTREAM_UNAVAILABLE:A checkout dependency is temporarily unavailable. Your cart is safe.",
    );
  if (
    state.scenario === "checkout-regression" &&
    checkoutService.featureFlags["new-tax-rounding"] &&
    hash01(`${state.seed}:${input.requestId}`) < 0.4
  )
    throw new Error(
      "UPSTREAM_UNAVAILABLE:We could not validate this checkout. Your cart is safe. Please try again.",
    );
  if (
    state.scenario === "payment-outage" &&
    state.services["payment-gateway"].provider === "primary" &&
    !state.primaryProviderAvailable
  )
    throw new Error(
      "UPSTREAM_UNAVAILABLE:Payment authorization is taking longer than expected. No charge was made.",
    );
  if (
    state.scenario === "inventory-saturation" &&
    state.services["inventory-db"].replicas < 4 &&
    hash01(`${state.seed}:${input.requestId}:inventory`) < 0.7
  )
    throw new Error(
      "UPSTREAM_UNAVAILABLE:We could not confirm inventory in time. Your cart is unchanged.",
    );
  const items = cart.items.map((item) => {
    const product = state.products.find((entry) => entry.id === item.productId);
    if (!product || product.inventory < item.quantity)
      throw new Error(
        "PRECONDITION_FAILED:An item is no longer available in the requested quantity.",
      );
    return {
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: product.price,
    };
  });
  const subtotal = items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0,
  );
  const order: Order = {
    id: id("ORD", state.orders.length + 1001),
    cartId: cart.id,
    email: input.email,
    name: input.name,
    address: input.address,
    total: subtotal + (subtotal >= 500 ? 0 : 45),
    status: "confirmed",
    createdAt: state.virtualNow,
    items,
  };
  for (const item of items) {
    const product = state.products.find((entry) => entry.id === item.productId);
    if (product) product.inventory -= item.quantity;
  }
  state.orders.push(order);
  cart.items = [];
  cart.updatedAt = state.virtualNow;
  state.idempotency[input.idempotencyKey] = { fingerprint, result: order };
  return order;
};

export const createTraceId = (): string =>
  `tr_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
