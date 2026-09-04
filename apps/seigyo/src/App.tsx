import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  ChevronRight,
  CircleGauge,
  Clock3,
  Command,
  Database,
  FileCheck2,
  GitBranch,
  History,
  ListFilter,
  LoaderCircle,
  Menu,
  Network,
  RotateCcw,
  Rocket,
  Search,
  Server,
  Settings,
  TerminalSquare,
  X,
} from "lucide-react";
import type {
  DependencyEdge,
  Deployment,
  Incident,
  LogEvent,
  MetricPoint,
  Receipt,
  ScenarioId,
  ServiceHealth,
  ServiceId,
  ServiceRuntime,
  EnvironmentSnapshot,
} from "@seigyo/contracts";
import { api, ApiError, storefrontUrl, websocketUrl } from "./api";
import { ProviderMark } from "./ProviderMark";
import { registerSeigyoTools } from "./webmcp";
import { AgentConsole } from "./AgentConsoleView";
import { cancelAllPendingApprovals } from "./agentConsole";

type Notice = {
  id: string;
  tone: "success" | "danger" | "info";
  title: string;
  message: string;
};
type ServicesResponse = { health: ServiceHealth[] };
type IncidentResponse = {
  incident: Incident;
  metrics: MetricPoint[];
  logs: LogEvent[];
  deployments: Deployment[];
};

const nav = [
  ["/", "Overview", CircleGauge],
  ["/incidents", "Incidents", AlertTriangle],
  ["/services", "Services", Network],
  ["/deployments", "Deployments", GitBranch],
  ["/evidence", "Metrics & logs", TerminalSquare],
  ["/runbooks", "Runbooks", FileCheck2],
  ["/receipts", "Recovery history", History],
  ["/settings", "Environment", Settings],
] as const;

const fmtTime = (value: number) =>
  new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
const fmtDate = (value: number) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
const pct = (value: number) => `${(value * 100).toFixed(value < 0.1 ? 2 : 1)}%`;
const label = (value: string) =>
  value.replaceAll("_", " ").replaceAll("-", " ");

function Brand() {
  return (
    <div className="brand">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M8 9.5A9.5 9.5 0 1 1 6.7 20" />
        <path d="M4 19.5 7.2 21l1.5-3.2" />
        <circle cx="16" cy="16" r="3.5" />
      </svg>
      <span>Seigyo</span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return <span className={`status status-${status}`}>{label(status)}</span>;
}

function Toasts({
  notices,
  dismiss,
}: {
  notices: Notice[];
  dismiss(id: string): void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      <AnimatePresence>
        {notices.map((item) => (
          <motion.div
            key={item.id}
            className={`toast toast-${item.tone}`}
            initial={reduceMotion ? false : { opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, x: 20 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
          >
            <div>
              <strong>{item.title}</strong>
              <p>{item.message}</p>
            </div>
            <button
              onClick={() => dismiss(item.id)}
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function MiniMetric({
  label: metricLabel,
  value,
  detail,
  direction = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  direction?: "up" | "down" | "neutral";
}) {
  return (
    <div className="metric">
      <div className="eyebrow">{metricLabel}</div>
      <div className="metric-value">{value}</div>
      <div className={`metric-detail ${direction}`}>
        {direction === "up" ? (
          <ArrowUpRight size={13} />
        ) : direction === "down" ? (
          <ArrowDownRight size={13} />
        ) : null}
        {detail}
      </div>
    </div>
  );
}

function ChartPanel({ metrics }: { metrics: MetricPoint[] }) {
  const serviceId = useMemo(() => {
    const latestAt = Math.max(0, ...metrics.map((item) => item.timestamp));
    return (
      metrics
        .filter((item) => item.timestamp === latestAt)
        .sort((a, b) => b.errorRate - a.errorRate)[0]?.serviceId ??
      metrics[0]?.serviceId ??
      "checkout-api"
    );
  }, [metrics]);
  const data = useMemo(
    () =>
      metrics
        .filter((item) => item.serviceId === serviceId)
        .slice(-60)
        .map((item) => ({
          time: fmtTime(item.timestamp),
          errors: +(item.errorRate * 100).toFixed(2),
          latency: item.p95Ms,
        })),
    [metrics, serviceId],
  );
  return (
    <section className="panel chart-panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">Focal signal</span>
          <h2>{label(serviceId)} reliability</h2>
        </div>
        <div className="chart-legend">
          <span>
            <i className="dot blue" />
            Error %
          </span>
          <span>
            <i className="dot amber" />
            P95 ms
          </span>
        </div>
      </div>
      <div
        className="chart-wrap"
        role="img"
        aria-label={`${label(serviceId)} error rate and p95 latency over the last sixty metric samples`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="errorFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#86aef8" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#86aef8" stopOpacity="0" />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#343d49" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fill: "#a6b0bd", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              minTickGap={50}
            />
            <YAxis
              yAxisId="left"
              tick={{ fill: "#a6b0bd", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: "#a6b0bd", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "#1b212a",
                color: "#f4f7fa",
                border: "1px solid #343d49",
                borderRadius: 6,
                fontSize: 12,
              }}
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="errors"
              stroke="#86aef8"
              strokeWidth={1.5}
              fill="url(#errorFill)"
            />
            <Area
              yAxisId="right"
              type="monotone"
              dataKey="latency"
              stroke="#f1c06a"
              strokeWidth={1}
              fill="transparent"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-alt" tabIndex={0} aria-label="Latest metric values">
        <span>Latest error: {data.at(-1)?.errors ?? 0}%</span>
        <span>Latest latency: {data.at(-1)?.latency ?? 0} ms</span>
        <span>60 deterministic samples</span>
      </div>
      <details className="chart-table">
        <summary>View metric table</summary>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Error rate</th>
              <th>P95 latency</th>
            </tr>
          </thead>
          <tbody>
            {data.slice(-10).map((row, index) => (
              <tr key={`${row.time}-${index}`}>
                <td>{row.time}</td>
                <td>{row.errors}%</td>
                <td>{row.latency} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function DependencyMap({
  services,
  health,
  edges,
}: {
  services: ServiceRuntime[];
  health: ServiceHealth[];
  edges: DependencyEdge[];
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<ServiceId, HTMLDivElement>());
  const frame = useRef<number | null>(null);
  const markerId = `dependency-arrow-${useId().replaceAll(":", "")}`;
  const healthById = useMemo(
    () => new Map(health.map((item) => [item.serviceId, item.status])),
    [health],
  );
  const [geometry, setGeometry] = useState<{
    width: number;
    height: number;
    paths: Array<
      DependencyEdge & {
        d: string;
        startX: number;
        startY: number;
        endX: number;
        endY: number;
      }
    >;
  }>({ width: 0, height: 0, paths: [] });

  const measure = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const mapElement = mapRef.current;
      if (!mapElement) return;
      const mapRect = mapElement.getBoundingClientRect();
      const paths = edges.flatMap((edge) => {
        const source = nodeRefs.current.get(edge.from)?.getBoundingClientRect();
        const target = nodeRefs.current.get(edge.to)?.getBoundingClientRect();
        if (!source || !target) return [];
        const startX = source.right - mapRect.left;
        const startY = source.top + source.height / 2 - mapRect.top;
        const endX = target.left - mapRect.left;
        const endY = target.top + target.height / 2 - mapRect.top;
        const distance = endX - startX;
        const direction = distance >= 0 ? 1 : -1;
        const offset = Math.min(120, Math.max(32, Math.abs(distance) * 0.45));
        return [
          {
            ...edge,
            startX,
            startY,
            endX,
            endY,
            d: `M ${startX} ${startY} C ${startX + direction * offset} ${startY}, ${endX - direction * offset} ${endY}, ${endX} ${endY}`,
          },
        ];
      });
      setGeometry({ width: mapRect.width, height: mapRect.height, paths });
    });
  }, [edges]);

  useLayoutEffect(() => {
    const mapElement = mapRef.current;
    if (!mapElement) return;
    const observer = new ResizeObserver(measure);
    observer.observe(mapElement);
    for (const node of nodeRefs.current.values()) observer.observe(node);
    const onTransitionEnd = () => measure();
    document
      .querySelector(".sidebar")
      ?.addEventListener("transitionend", onTransitionEnd);
    window.addEventListener("resize", measure);
    void document.fonts.ready.then(measure);
    measure();
    return () => {
      observer.disconnect();
      document
        .querySelector(".sidebar")
        ?.removeEventListener("transitionend", onTransitionEnd);
      window.removeEventListener("resize", measure);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [measure, services]);

  const areas: Record<ServiceId, string> = {
    "storefront-edge": "n1",
    "catalog-api": "n2",
    "cart-api": "n3",
    "checkout-api": "n4",
    "payment-gateway": "n5",
    "inventory-db": "n6",
    "order-worker": "n7",
  };
  return (
    <section className="panel dependency-panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">Request path</span>
          <h2>Service topology</h2>
        </div>
        <Network size={17} />
      </div>
      <div
        className="dependency-scroll"
        tabIndex={0}
        aria-label="Scrollable service topology"
      >
        <div className="dependency-map" ref={mapRef}>
          {services.map((service) => (
            <div
              ref={(node) => {
                if (node) nodeRefs.current.set(service.id, node);
                else nodeRefs.current.delete(service.id);
              }}
              className={`dependency-node dependency-${healthById.get(service.id) ?? "healthy"}`}
              key={service.id}
              data-service-id={service.id}
              style={{ gridArea: areas[service.id] }}
            >
              <span className="node-light" />
              <span className="node-label">{service.name}</span>
              <ProviderMark hosting={service.hosting} compact />
              <small className="node-status">
                {healthById.get(service.id) ?? "unknown"}
              </small>
            </div>
          ))}
          <svg
            width={geometry.width}
            height={geometry.height}
            viewBox={`0 0 ${geometry.width || 1} ${geometry.height || 1}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${geometry.paths.length} directed service dependencies`}
          >
            <defs>
              <marker
                id={markerId}
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 7 4 L 0 7 z" className="dependency-arrow" />
              </marker>
            </defs>
            {geometry.paths.map((path) => {
              const impaired =
                healthById.get(path.from) !== "healthy" ||
                healthById.get(path.to) !== "healthy";
              return (
                <g
                  key={`${path.from}-${path.to}`}
                  className={
                    impaired ? "dependency-edge impaired" : "dependency-edge"
                  }
                  data-edge-from={path.from}
                  data-edge-to={path.to}
                >
                  <path d={path.d} markerEnd={`url(#${markerId})`} />
                  <circle cx={path.startX} cy={path.startY} r="2.5" />
                  <circle cx={path.endX} cy={path.endY} r="2.5" />
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </section>
  );
}

function Overview({ data }: { data: EnvironmentSnapshot }) {
  const active = data.activeIncident;
  const status = data.operationalStatus;
  const checkout =
    data.health.find((item) => item.serviceId === "checkout-api") ??
    data.health[0]!;
  const checkoutMeetsObjective = checkout.errorRate <= 0.005;
  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow">Production / live</span>
          <h1>Operations overview</h1>
        </div>
        <button className="button button-ghost">
          <ListFilter size={15} />
          Last 3 hours
        </button>
      </header>
      <div
        className={`impact-strip environment-status status-strip-${status.state}`}
      >
        <div className="impact-main">
          <span className={`severity-dot status-dot-${status.state}`} />
          <div>
            <span className="eyebrow">Current status</span>
            <h2>{status.label}</h2>
          </div>
          {active && (
            <NavLink
              className="status-incident-link"
              to={`/incidents/${active.id}`}
            >
              {active.id} <ChevronRight size={14} />
            </NavLink>
          )}
        </div>
        <div className="impact-meta">
          <span>
            <strong>{status.customerErrorsPerMinute}</strong> customer
            errors/min
          </span>
          <span>
            <strong>{status.ordersAtRisk}</strong> orders at risk
          </span>
          <span>
            <strong>{status.impairedServiceCount}</strong> impaired services
          </span>
          <span>
            <strong>{fmtTime(status.updatedAt)}</strong> last update
          </span>
        </div>
      </div>
      <div className="metric-grid">
        <MiniMetric
          label="Checkout success"
          value={pct(1 - checkout.errorRate)}
          detail={
            checkoutMeetsObjective
              ? "meets 99.5% objective"
              : "below 99.5% objective"
          }
          direction={checkoutMeetsObjective ? "neutral" : "down"}
        />
        <MiniMetric
          label="P95 latency"
          value={`${checkout.p95Ms} ms`}
          detail="customer checkout"
          direction="up"
        />
        <MiniMetric
          label="Revenue at risk"
          value={`$${(status.ordersAtRisk * 312).toLocaleString()}`}
          detail="estimated this hour"
          direction="up"
        />
        <MiniMetric
          label="Active services"
          value={`${data.health.filter((item) => item.status === "healthy").length} / 7`}
          detail={`${data.health.filter((item) => item.status !== "healthy").length} impaired`}
        />
      </div>
      <div className="workspace-grid">
        <ChartPanel
          metrics={
            (data as EnvironmentSnapshot & { metrics?: MetricPoint[] })
              .metrics ?? []
          }
        />
        <DependencyMap
          services={data.services}
          health={data.health}
          edges={data.dependencyEdges}
        />
      </div>
    </>
  );
}

function Incidents({ data }: { data: EnvironmentSnapshot }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("view") === "history" ? "history" : "active";
  const incidents = data.incidents.filter((incident) =>
    view === "history"
      ? incident.status === "resolved"
      : incident.status !== "resolved",
  );
  return (
    <Page
      title="Incidents"
      subtitle="Current and historical operational events"
    >
      <div
        className="incident-tabs"
        role="tablist"
        aria-label="Incident records"
      >
        <button
          role="tab"
          aria-selected={view === "active"}
          className={view === "active" ? "active" : ""}
          onClick={() => setSearchParams({})}
        >
          Active <span>{data.operationalStatus.openIncidentCount}</span>
        </button>
        <button
          role="tab"
          aria-selected={view === "history"}
          className={view === "history" ? "active" : ""}
          onClick={() => setSearchParams({ view: "history" })}
        >
          History{" "}
          <span>
            {data.incidents.length - data.operationalStatus.openIncidentCount}
          </span>
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Incident</th>
              <th>Service</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Customer impact</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {incidents.map((item) => (
              <tr key={item.id}>
                <td>
                  <NavLink className="table-link" to={`/incidents/${item.id}`}>
                    <strong>{item.id}</strong>
                    <span>{item.title}</span>
                  </NavLink>
                </td>
                <td>
                  <code>{item.serviceId}</code>
                </td>
                <td>
                  <StatusPill status={item.severity} />
                </td>
                <td>
                  <StatusPill status={item.status} />
                </td>
                <td>{item.customerErrorsPerMinute} errors/min</td>
                <td>{fmtDate(item.startedAt)}</td>
              </tr>
            ))}
            {incidents.length === 0 && (
              <tr className="empty-table-row">
                <td colSpan={6}>
                  No active incidents. The environment is operating normally.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

function IncidentWorkspace({
  data,
  reload,
  notify,
}: {
  data: EnvironmentSnapshot;
  reload(): Promise<void>;
  notify: (tone: Notice["tone"], title: string, message: string) => void;
}) {
  const { id: incidentId } = useParams();
  const [detail, setDetail] = useState<IncidentResponse | null>(null);
  const [investigation, setInvestigation] = useState<{
    summary: string;
    hypotheses: Array<{
      statement: string;
      confidence: number;
      evidenceRefs: string[];
    }>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const matchedIncident = data.incidents.find((item) => item.id === incidentId);
  const active = matchedIncident;
  const isActive = active?.status !== "resolved";
  useEffect(() => {
    if (active) void api.incident<IncidentResponse>(active.id).then(setDetail);
  }, [active, data.observabilityRevision]);
  const investigate = async () => {
    if (!active || !isActive) {
      notify(
        "info",
        "Historical incident",
        "Historical incidents are read-only.",
      );
      return;
    }
    setBusy(true);
    try {
      const result = await api.investigate<typeof investigation>(active.id);
      setInvestigation(result);
      notify(
        "success",
        "Investigation complete",
        "Metrics, logs, dependencies, and deployments were correlated.",
      );
      await reload();
    } catch (error) {
      notify(
        "danger",
        "Investigation failed",
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      setBusy(false);
    }
  };
  const proposal = data.proposals.find(
    (item) => item.incidentId === active?.id,
  );
  const execution = data.executions.find(
    (item) => item.incidentId === active?.id,
  );
  const verification = data.verifications.find(
    (item) => item.executionId === execution?.id,
  );
  if (!matchedIncident)
    return (
      <Page
        title="Incident not found"
        subtitle="The requested incident does not exist in this environment."
        backTo="/incidents"
        backLabel="Back to incidents"
      >
        <section className="panel empty-page">
          <AlertTriangle size={24} />
          <h2>No matching incident</h2>
          <p>Return to the incident list and choose an available record.</p>
          <NavLink className="text-link" to="/incidents">
            View incidents <ChevronRight size={14} />
          </NavLink>
        </section>
      </Page>
    );
  return (
    <Page
      title={matchedIncident.title}
      subtitle={`${matchedIncident.id} · ${matchedIncident.impact}`}
      backTo={
        matchedIncident.status === "resolved"
          ? "/incidents?view=history"
          : "/incidents"
      }
      backLabel="Back to incidents"
      actions={
        <div className="button-row">
          <button
            className="button button-ghost"
            disabled={busy}
            onClick={investigate}
          >
            {busy ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Search size={15} />
            )}
            Investigate
          </button>
        </div>
      }
    >
      <div className="incident-layout">
        <div className="incident-main">
          <ChartPanel metrics={detail?.metrics ?? []} />
          <section className="panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">Evidence</span>
                <h2>Leading hypotheses</h2>
              </div>
            </div>
            {investigation ? (
              <div className="hypothesis-list">
                {investigation.hypotheses.map((item, index) => (
                  <div className="hypothesis" key={item.statement}>
                    <span>H{index + 1}</span>
                    <div>
                      <strong>{item.statement}</strong>
                      <p>{item.evidenceRefs.join(" · ")}</p>
                    </div>
                    <b>{Math.round(item.confidence * 100)}%</b>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-inline tall">
                <Search size={18} />
                <span>
                  Run the investigation to correlate the live evidence.
                </span>
              </div>
            )}
          </section>
          <section className="panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">Recent events</span>
                <h2>Evidence stream</h2>
              </div>
            </div>
            <div className="log-list">
              {detail?.logs.slice(0, 8).map((log) => (
                <div key={log.id} className="log-row">
                  <time>{fmtTime(log.timestamp)}</time>
                  <StatusPill status={log.level} />
                  <code>{log.serviceId}</code>
                  <span>{log.message}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
        <aside className="incident-side">
          {!proposal && (
            <section className="panel stage-card">
              <span className="stage-number">01</span>
              <h3>Investigate first</h3>
              <p>
                Collect evidence before proposing any state-changing action.
              </p>
            </section>
          )}
          <section className="panel control-card">
            <span className="eyebrow">Controlled recovery</span>
            <div className="control-step">
              <span className={investigation ? "done" : ""}>1</span>
              <div>
                <strong>Evidence correlated</strong>
                <small>{investigation ? "Complete" : "Waiting"}</small>
              </div>
            </div>
            <div className="control-step">
              <span className={proposal ? "done" : ""}>2</span>
              <div>
                <strong>Action proposed</strong>
                <small>{proposal ? proposal.status : "Waiting"}</small>
              </div>
            </div>
            <div className="control-step">
              <span className={execution ? "done" : ""}>3</span>
              <div>
                <strong>Execute exact action</strong>
                <small>{execution?.state ?? "Waiting"}</small>
              </div>
            </div>
            <div className="control-step">
              <span className={verification ? "done" : ""}>4</span>
              <div>
                <strong>Verify recovery</strong>
                <small>{verification?.outcome ?? "Waiting"}</small>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </Page>
  );
}

function Services({ data }: { data: EnvironmentSnapshot }) {
  const providerCount = new Set(
    data.services.map((service) => service.hosting.providerId),
  ).size;
  const regions = [
    ...new Set(data.services.map((service) => service.hosting.region)),
  ];
  return (
    <Page
      title="Services"
      subtitle="Hosting ownership and runtime health across the customer request path"
    >
      <div className="service-summary" aria-label="Architecture summary">
        <span>
          <strong>{providerCount}</strong> providers
        </span>
        <span>
          <strong>{data.services.length}</strong> services
        </span>
        <span>
          <strong>{regions.length}</strong> active regions
        </span>
        <span className="summary-regions">{regions.join(" + ")}</span>
      </div>
      <div
        className="service-list"
        role="table"
        aria-label="Service hosting and health"
      >
        <div className="service-header" role="row">
          <span role="columnheader">Service</span>
          <span role="columnheader">Provider</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Runtime</span>
          <span role="columnheader">Signals</span>
        </div>
        {data.services.map((service) => {
          const health = data.health.find(
            (item) => item.serviceId === service.id,
          )!;
          return (
            <section className="service-row" role="row" key={service.id}>
              <div className="service-identity" role="cell">
                <span className="service-symbol">
                  <Server size={17} />
                </span>
                <span className="service-name">
                  <strong>{service.name}</strong>
                  <code>{service.id}</code>
                </span>
              </div>
              <div className="service-hosting" role="cell">
                <ProviderMark hosting={service.hosting} />
                <span className="hosting-location">
                  {service.hosting.region}
                </span>
                <code>{service.hosting.resourceId}</code>
              </div>
              <div className="service-status" role="cell">
                <StatusPill status={health.status} />
              </div>
              <div className="service-runtime" role="cell">
                <span>
                  <b>Version</b>
                  {service.version}
                </span>
                <span>
                  <b>Replicas</b>
                  {service.replicas}
                </span>
              </div>
              <div className="service-signals" role="cell">
                <span>
                  <b>Error</b>
                  {pct(health.errorRate)}
                </span>
                <span>
                  <b>P95</b>
                  {health.p95Ms} ms
                </span>
              </div>
            </section>
          );
        })}
      </div>
      <DependencyMap
        services={data.services}
        health={data.health}
        edges={data.dependencyEdges}
      />
    </Page>
  );
}

function Deployments({ data }: { data: EnvironmentSnapshot }) {
  return (
    <Page title="Deployments" subtitle="Release history with causal markers">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Deployment</th>
              <th>Service</th>
              <th>Version</th>
              <th>Summary</th>
              <th>Actor</th>
              <th>Status</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {data.deployments.slice(0, 30).map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.id}</strong>
                </td>
                <td>
                  <code>{item.serviceId}</code>
                </td>
                <td>{item.version}</td>
                <td>{item.summary}</td>
                <td>{item.actor}</td>
                <td>
                  <StatusPill status={item.status} />
                </td>
                <td>{fmtDate(item.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

function Evidence({ data }: { data: EnvironmentSnapshot }) {
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [metrics, setMetrics] = useState<MetricPoint[]>([]);
  useEffect(() => {
    void Promise.all([
      api.logs<LogEvent[]>(),
      api.metrics<MetricPoint[]>(),
    ]).then(([a, b]) => {
      setLogs(a);
      setMetrics(b);
    });
  }, [data.observabilityRevision]);
  return (
    <Page
      title="Metrics & logs"
      subtitle="Bounded operational evidence, safe to inspect"
    >
      <ChartPanel metrics={metrics} />
      <section className="panel log-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Live evidence</span>
            <h2>Recent logs</h2>
          </div>
          <TerminalSquare size={17} />
        </div>
        <div className="log-list">
          {logs.map((log) => (
            <div key={log.id} className="log-row">
              <time>{fmtTime(log.timestamp)}</time>
              <StatusPill status={log.level} />
              <code>{log.serviceId}</code>
              <span>{log.message}</span>
              <small>{log.traceId}</small>
            </div>
          ))}
        </div>
      </section>
    </Page>
  );
}

function Runbooks() {
  const [items, setItems] = useState<
    Array<{ id: string; title: string; serviceId: string; steps: string[] }>
  >([]);
  useEffect(() => {
    void api.runbooks<typeof items>().then(setItems);
  }, []);
  return (
    <Page title="Runbooks" subtitle="Human-readable operational playbooks">
      <div className="runbook-grid">
        {items.map((item) => (
          <section className="panel runbook" key={item.id}>
            <div className="runbook-icon">
              <FileCheck2 size={17} />
            </div>
            <span className="eyebrow">
              {item.id} · {label(item.serviceId)}
            </span>
            <h2>{item.title}</h2>
            <ol>
              {item.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </Page>
  );
}

function Receipts({ data }: { data: EnvironmentSnapshot }) {
  return (
    <Page
      title="Recovery history"
      subtitle="Tamper-evident intervention receipts"
    >
      <div className="receipt-list">
        {data.receipts.length === 0 ? (
          <section className="panel empty-page">
            <Database size={24} />
            <h2>No receipts yet</h2>
            <p>
              Verified interventions will be recorded here with chained state
              hashes.
            </p>
          </section>
        ) : (
          data.receipts.map((item) => <ReceiptRow item={item} key={item.id} />)
        )}
      </div>
    </Page>
  );
}
function ReceiptRow({ item }: { item: Receipt }) {
  return (
    <section className="receipt">
      <div className="receipt-icon">
        <FileCheck2 size={17} />
      </div>
      <div>
        <div className="receipt-title">
          <strong>{item.id}</strong>
          <StatusPill status={item.result} />
        </div>
        <p>
          {label(item.action.type)} on <code>{item.action.targetService}</code>
        </p>
      </div>
      <dl>
        <div>
          <dt>Action hash</dt>
          <dd>{item.actionHash.slice(0, 14)}…</dd>
        </div>
        <div>
          <dt>Receipt hash</dt>
          <dd>{item.receiptHash.slice(0, 14)}…</dd>
        </div>
        <div>
          <dt>Executed</dt>
          <dd>{fmtDate(item.executedAt)}</dd>
        </div>
      </dl>
    </section>
  );
}

function Environment({
  data,
  reload,
  notify,
}: {
  data: EnvironmentSnapshot;
  reload(): Promise<void>;
  notify: (tone: Notice["tone"], title: string, message: string) => void;
}) {
  const [scenario, setScenario] = useState<ScenarioId>(data.scenario);
  const [busy, setBusy] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [baselineBusy, setBaselineBusy] = useState(false);
  const checkoutService = data.services.find(
    (service) => service.id === "checkout-api",
  );
  const releaseAvailable =
    data.operationalStatus.state === "operational" &&
    data.operationalStatus.openIncidentCount === 0 &&
    !data.deployments.some((deployment) => deployment.status === "in_progress");
  const deployRevision = async () => {
    setReleaseBusy(true);
    try {
      const result = await api.deployCheckoutRevision(crypto.randomUUID());
      cancelAllPendingApprovals(
        "A new checkout revision changed the operating state.",
      );
      notify(
        "success",
        "Checkout revision deployed",
        `${result.deployment.version} is live. Seigyo detected a new checkout incident.`,
      );
      await reload();
    } catch (error) {
      notify(
        "danger",
        "Deployment failed",
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      setReleaseBusy(false);
    }
  };
  const reset = async () => {
    setBusy(true);
    try {
      await api.reset(scenario);
      cancelAllPendingApprovals(
        "The environment changed before the proposal was executed.",
      );
      notify(
        "success",
        "Environment reset",
        "State, incidents, metrics, and approval validity were reset deterministically.",
      );
      await reload();
    } finally {
      setBusy(false);
    }
  };
  const restoreHealthyBaseline = async () => {
    if (baselineBusy) return;
    setBaselineBusy(true);
    try {
      await api.restoreHealthy<EnvironmentSnapshot>();
      cancelAllPendingApprovals(
        "The environment returned to its healthy baseline.",
      );
      notify(
        "success",
        "Healthy baseline restored",
        "All services are operational and ready for a new checkout revision.",
      );
      await reload();
    } catch (error) {
      notify(
        "danger",
        "Baseline restore failed",
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      setBaselineBusy(false);
    }
  };
  return (
    <Page
      title="Environment configuration"
      subtitle="Production environment controls and operating metadata"
    >
      <section className="panel settings-panel release-control-panel">
        <div className="release-control-copy">
          <span className="eyebrow">Release control</span>
          <h2>Checkout API</h2>
          <p>
            Deploy a new checkout revision to the production environment. The
            release takes effect immediately.
          </p>
        </div>
        <dl className="release-control-meta">
          <div>
            <dt>Current revision</dt>
            <dd>{checkoutService?.version ?? "Unavailable"}</dd>
          </div>
          <div>
            <dt>Environment status</dt>
            <dd>{data.operationalStatus.label}</dd>
          </div>
        </dl>
        <div className="release-control-action">
          <button
            className="button button-primary"
            onClick={deployRevision}
            disabled={!releaseAvailable || releaseBusy}
          >
            {releaseBusy ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Rocket size={15} />
            )}
            {releaseBusy ? "Deploying revision" : "Deploy new revision"}
          </button>
          <a
            className="button button-ghost"
            href={storefrontUrl()}
            target="_blank"
            rel="noreferrer"
          >
            Open storefront
          </a>
          {!releaseAvailable && (
            <p className="release-control-disabled" role="status">
              Resolve the current operating issue before deploying another
              checkout revision.
            </p>
          )}
        </div>
      </section>
      <div className="settings-grid">
        <section className="panel settings-panel">
          <span className="eyebrow">Operational state</span>
          <h2>Operating condition</h2>
          <p>
            Choose a causal condition. Agents still decide how to investigate
            and respond. Nothing here scripts their tool sequence.
          </p>
          <label>
            <span>Active condition</span>
            <select
              value={scenario}
              onChange={(event) =>
                setScenario(event.target.value as ScenarioId)
              }
            >
              <option value="checkout-regression">
                Checkout deployment regression
              </option>
              <option value="payment-outage">Payment provider outage</option>
              <option value="inventory-saturation">
                Inventory database saturation
              </option>
            </select>
          </label>
          <button
            className="button button-danger"
            onClick={reset}
            disabled={busy || scenario === data.scenario}
          >
            {busy ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <RotateCcw size={15} />
            )}
            Reset to selected condition
          </button>
        </section>
        <section className="panel settings-panel">
          <span className="eyebrow">Environment</span>
          <h2>Production</h2>
          <dl className="settings-dl">
            <div>
              <dt>Epoch</dt>
              <dd>{data.epoch}</dd>
            </div>
            <div>
              <dt>Causal revision</dt>
              <dd>{data.causalRevision}</dd>
            </div>
            <div>
              <dt>Observability revision</dt>
              <dd>{data.observabilityRevision}</dd>
            </div>
            <div>
              <dt>Virtual clock</dt>
              <dd>{fmtDate(data.virtualNow)}</dd>
            </div>
            <div>
              <dt>
                <button
                  type="button"
                  className="settings-stealth-trigger"
                  onClick={restoreHealthyBaseline}
                  disabled={baselineBusy}
                  aria-label="Restore healthy baseline"
                >
                  WebMCP
                </button>
              </dt>
              <dd>
                {document.modelContext ? "Available" : "Browser unsupported"}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </Page>
  );
}

function Page({
  title,
  subtitle,
  actions,
  backTo,
  backLabel,
  children,
}: {
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
  backTo?: string;
  backLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="page-head">
        <div>
          {backTo && (
            <NavLink className="back-link" to={backTo}>
              <ArrowLeft size={15} /> {backLabel ?? "Back"}
            </NavLink>
          )}
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {actions}
      </header>
      {children}
    </>
  );
}

function CommandPalette({ open, close }: { open: boolean; close(): void }) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [query, setQuery] = useState("");
  const matches = nav.filter(([, name]) =>
    name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="palette-backdrop"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
          onMouseDown={close}
        >
          <motion.div
            className="palette"
            initial={reduceMotion ? false : { opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
          >
            <div className="palette-search">
              <Search size={16} />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Navigate or find a command"
              />
              <kbd>Esc</kbd>
            </div>
            <div className="palette-list">
              <span className="eyebrow">Navigate</span>
              {matches.map(([path, name, Icon]) => (
                <button
                  key={path}
                  onClick={() => {
                    navigate(path);
                    close();
                  }}
                >
                  <Icon size={16} />
                  <span>{name}</span>
                  <ChevronRight size={14} />
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function App() {
  const [data, setData] = useState<EnvironmentSnapshot | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [palette, setPalette] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const reduceMotion = useReducedMotion();
  const location = useLocation();
  const notify = useCallback(
    (tone: Notice["tone"], title: string, message: string) => {
      const id = crypto.randomUUID();
      setNotices((current) =>
        [...current, { id, tone, title, message }].slice(-4),
      );
      window.setTimeout(
        () => setNotices((current) => current.filter((item) => item.id !== id)),
        6000,
      );
    },
    [],
  );
  const reload = useCallback(async () => {
    try {
      const next = await api.snapshot<EnvironmentSnapshot>();
      const metrics = await api.metrics<MetricPoint[]>(undefined, 300);
      setData(Object.assign(next, { metrics }));
      setConnectionError("");
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "The operations API could not be reached.";
      setConnectionError(message);
      notify("danger", "Connection failed", message);
    }
  }, [notify]);
  useEffect(() => {
    void reload();
    return registerSeigyoTools();
  }, [reload]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((value) => !value);
      }
      if (event.key === "Escape") setPalette(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!palette) return;
    const invoker = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>(".palette");
    if (!dialog) return;
    const focusable = () => [
      ...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])',
      ),
    ];
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      invoker?.focus();
    };
  }, [palette]);
  useEffect(() => {
    let socket: WebSocket | undefined;
    try {
      socket = new WebSocket(websocketUrl());
      socket.addEventListener("message", () => {
        void reload();
      });
    } catch {
      return;
    }
    return () => socket?.close();
  }, [reload]);
  useEffect(() => {
    setMobileNav(false);
  }, [location.pathname]);
  if (!data)
    return (
      <div className="loading-screen">
        <Brand />
        {connectionError ? (
          <>
            <AlertTriangle size={22} />
            <p>{connectionError}</p>
            <button
              className="button button-primary"
              onClick={() => void reload()}
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <div className="loading-line">
              <i />
            </div>
            <p>Connecting to the recovery environment</p>
          </>
        )}
      </div>
    );
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <div className="sidebar-top">
          <Brand />
          <button
            className="icon-button mobile-close"
            onClick={() => setMobileNav(false)}
            aria-label="Close navigation"
          >
            <X size={17} />
          </button>
        </div>
        <div className="environment">
          <span className="env-dot" />
          <div>
            <strong>Production</strong>
            <small>Multi-region commerce</small>
          </div>
        </div>
        <nav>
          {nav.map(([path, name, Icon]) => (
            <NavLink
              key={path}
              end={path === "/"}
              to={path}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              <Icon size={16} />
              <span>{name}</span>
              {name === "Incidents" &&
                data.operationalStatus.openIncidentCount > 0 && (
                  <b>{data.operationalStatus.openIncidentCount}</b>
                )}
            </NavLink>
          ))}
        </nav>
        <button className="command-trigger" onClick={() => setPalette(true)}>
          <Command size={15} />
          <span>Command palette</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div className="sidebar-foot">
          <div className="avatar">RB</div>
          <div>
            <strong>Randy B.</strong>
            <small>Incident commander</small>
          </div>
          <NavLink
            className="icon-button"
            to="/settings"
            aria-label="Operator settings"
          >
            <Settings size={15} />
          </NavLink>
        </div>
      </aside>
      <main>
        <div className="mobile-bar">
          <button
            className="icon-button"
            onClick={() => setMobileNav(true)}
            aria-label="Open navigation"
          >
            <Menu size={18} />
          </button>
          <Brand />
          <span className="live-badge">
            <i />
            Live
          </span>
        </div>
        <motion.div
          className="page"
          key={location.pathname}
          initial={reduceMotion ? false : { y: 4 }}
          animate={{ y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.16 }}
        >
          <Routes>
            <Route path="/" element={<Overview data={data} />} />
            <Route path="/incidents" element={<Incidents data={data} />} />
            <Route
              path="/incidents/:id"
              element={
                <IncidentWorkspace
                  data={data}
                  reload={reload}
                  notify={notify}
                />
              }
            />
            <Route path="/services" element={<Services data={data} />} />
            <Route path="/deployments" element={<Deployments data={data} />} />
            <Route path="/evidence" element={<Evidence data={data} />} />
            <Route path="/runbooks" element={<Runbooks />} />
            <Route path="/receipts" element={<Receipts data={data} />} />
            <Route
              path="/settings"
              element={
                <Environment data={data} reload={reload} notify={notify} />
              }
            />
            <Route
              path="*"
              element={
                <Page
                  title="Page not found"
                  subtitle="The requested Seigyo page does not exist."
                >
                  <section className="panel empty-page">
                    <AlertTriangle size={24} />
                    <h2>No matching page</h2>
                    <NavLink className="text-link" to="/">
                      Return to overview <ChevronRight size={14} />
                    </NavLink>
                  </section>
                </Page>
              }
            />
          </Routes>
        </motion.div>
      </main>
      <AgentConsole reload={reload} notify={notify} />
      <Toasts
        notices={notices}
        dismiss={(id) =>
          setNotices((current) => current.filter((item) => item.id !== id))
        }
      />
      <CommandPalette open={palette} close={() => setPalette(false)} />
    </div>
  );
}
