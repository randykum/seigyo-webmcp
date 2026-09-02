import { DurableObject } from "cloudflare:workers";
import type { ProposalInput, RecoveryAction, ScenarioId, ServiceId } from "@seigyo/contracts";
import { approveProposal, checkout, executeProposal, getCart, investigate, queryMetrics, rejectProposal, resetSimulation, searchLogs, seedSimulation, snapshot, tick, undoExecution, updateCart, verifyExecution, proposeAction, computeHealth, type SimulationState } from "@seigyo/simulation";

type CheckoutRequest = { cartId: string; email: string; name: string; address: string; requestId: string; idempotencyKey: string };

export class SimulationStateObject extends DurableObject<Env> {
  private mutationQueue: Promise<void> = Promise.resolve();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS simulation_state (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL, updated_at INTEGER NOT NULL)");
      const existing = this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM simulation_state").one();
      if (existing.count === 0) {
        const initial = seedSimulation("checkout-regression");
        this.ctx.storage.sql.exec("INSERT INTO simulation_state (id, body, updated_at) VALUES (1, ?, ?)", JSON.stringify(initial), Date.now());
        await this.ctx.storage.setAlarm(Date.now() + 30_000);
      }
    });
  }

  private read(): SimulationState {
    const row = this.ctx.storage.sql.exec<{ body: string }>("SELECT body FROM simulation_state WHERE id = 1").one();
    const state = JSON.parse(row.body) as SimulationState;
    state.undoSnapshots ??= Object.create(null) as SimulationState["undoSnapshots"];
    return state;
  }

  private write(state: SimulationState, eventType = "state.updated"): void {
    state.observabilityRevision += 1;
    this.ctx.storage.sql.exec("UPDATE simulation_state SET body = ?, updated_at = ? WHERE id = 1", JSON.stringify(state), Date.now());
    this.broadcast({ type: eventType, sequence: state.observabilityRevision, payload: { epoch: state.epoch, causalRevision: state.causalRevision, observabilityRevision: state.observabilityRevision } });
  }

  private async mutate<T>(operation: (state: SimulationState) => Promise<T> | T, eventType: string): Promise<T> {
    let release: () => void = () => undefined;
    const previous = this.mutationQueue;
    this.mutationQueue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const state = this.read();
      const result = await operation(state);
      this.write(state, eventType);
      return result;
    } finally { release(); }
  }

  private broadcast(event: unknown): void {
    const message = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(message); } catch { socket.close(1011, "Delivery failed"); }
    }
  }

  override async alarm(): Promise<void> {
    await this.mutate(state => tick(state, 30), "metric.append");
    await this.ctx.storage.setAlarm(Date.now() + 30_000);
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket upgrade required", { status: 426 });
    if (this.ctx.getWebSockets().length >= 32) return new Response("WebSocket connection limit reached", { status: 429 });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const state = this.read();
    server.send(JSON.stringify({ type: "state.snapshot", sequence: state.observabilityRevision, payload: snapshot(state) }));
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    const size = typeof message === "string" ? new TextEncoder().encode(message).byteLength : message.byteLength;
    if (size > 256) { socket.close(1009, "Message too large"); return; }
    if (typeof message === "string" && message === "ping") socket.send(JSON.stringify({ type: "pong", at: Date.now() }));
  }

  override webSocketClose(socket: WebSocket, code: number, reason: string, wasClean: boolean): void {
    void socket; void code; void reason; void wasClean;
  }

  getSnapshot() { return snapshot(this.read()); }
  listIncidents() { return this.read().incidents; }
  getIncident(incidentId: string) { const state = this.read(); return { incident: state.incidents.find(item => item.id === incidentId), metrics: queryMetrics(state, state.incidents.find(item => item.id === incidentId)?.serviceId, 180), logs: searchLogs(state, state.incidents.find(item => item.id === incidentId)?.serviceId, "", 50), deployments: state.deployments.filter(item => item.serviceId === state.incidents.find(entry => entry.id === incidentId)?.serviceId).slice(0, 10) }; }
  listServices() { const state = this.read(); return { services: Object.values(state.services), health: computeHealth(state) }; }
  listDeployments(serviceId?: ServiceId) { return this.read().deployments.filter(item => !serviceId || item.serviceId === serviceId); }
  listDependencies(serviceId?: ServiceId) {
    const edges = [{ from: "storefront-edge", to: "catalog-api" }, { from: "storefront-edge", to: "cart-api" }, { from: "storefront-edge", to: "checkout-api" }, { from: "catalog-api", to: "inventory-db" }, { from: "cart-api", to: "inventory-db" }, { from: "checkout-api", to: "inventory-db" }, { from: "checkout-api", to: "payment-gateway" }, { from: "checkout-api", to: "order-worker" }, { from: "order-worker", to: "inventory-db" }];
    return serviceId ? edges.filter(edge => edge.from === serviceId || edge.to === serviceId) : edges;
  }
  getMetrics(serviceId?: ServiceId, limit = 180) { return queryMetrics(this.read(), serviceId, limit); }
  getLogs(serviceId?: ServiceId, query = "", limit = 50) { return searchLogs(this.read(), serviceId, query, limit); }
  getRunbooks() { return [{ id: "RB-01", title: "Rollback a checkout deployment", serviceId: "checkout-api", steps: ["Confirm deployment correlation", "Review active traffic", "Create a rollback proposal", "Verify error and latency recovery"] }, { id: "RB-02", title: "Fail over payment provider", serviceId: "payment-gateway", steps: ["Confirm upstream availability", "Check fallback capacity", "Switch provider", "Verify payment success"] }, { id: "RB-03", title: "Scale inventory capacity", serviceId: "inventory-db", steps: ["Confirm saturation", "Estimate required replicas", "Scale", "Verify queue depth"] }]; }
  getReceipts() { return this.read().receipts.slice().reverse(); }
  getAgentActivity() { return this.read().agentActivity.slice().reverse(); }

  async investigateIncident(incidentId: string) { return this.mutate(state => investigate(state, incidentId), "agent.activity"); }
  async createProposal(input: ProposalInput) { return this.mutate(state => proposeAction(state, input), "proposal.created"); }
  async approve(proposalId: string, sessionId: string) { return this.mutate(state => approveProposal(state, proposalId, sessionId), "proposal.approved"); }
  async reject(proposalId: string) { return this.mutate(state => rejectProposal(state, proposalId), "proposal.rejected"); }
  async execute(proposalId: string, approvalToken: string, idempotencyKey: string, sessionId: string) { return this.mutate(state => executeProposal(state, proposalId, approvalToken, idempotencyKey, sessionId), "execution.updated"); }
  async verify(executionId: string, incidentId: string) { return this.mutate(state => verifyExecution(state, executionId, incidentId), "receipt.created"); }
  async undo(executionId: string, idempotencyKey: string) { return this.mutate(state => undoExecution(state, executionId, idempotencyKey), "execution.updated"); }
  async reset(scenario: ScenarioId) { return this.mutate(state => { const next = resetSimulation(state, scenario); Object.assign(state, next); return snapshot(state); }, "scenario.reset"); }

  getProducts(query = "", category = "") { return this.read().products.filter(product => (!query || `${product.name} ${product.material} ${product.category}`.toLowerCase().includes(query.toLowerCase())) && (!category || product.category === category)); }
  getProduct(slug: string) { return this.read().products.find(product => product.slug === slug || product.id === slug); }
  getCart(cartId: string) { return getCart(this.read(), cartId); }
  async setCartItem(cartId: string, productId: string, quantity: number) { return this.mutate(state => updateCart(state, cartId, productId, quantity), "cart.updated"); }
  async createOrder(input: CheckoutRequest) { return this.mutate(state => checkout(state, input), "order.created"); }
  getOrder(orderId: string) { return this.read().orders.find(order => order.id === orderId); }
  getStoreHealth() { const state = this.read(); const health = computeHealth(state); return { status: health.some(item => item.status === "critical") ? "degraded" : health.some(item => item.status === "degraded") ? "impaired" : "healthy", services: health.filter(item => ["storefront-edge", "catalog-api", "cart-api", "checkout-api", "payment-gateway", "inventory-db"].includes(item.serviceId)), updatedAt: state.virtualNow }; }
}
