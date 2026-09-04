# Seigyo

Seigyo is an agent-native incident investigation and controlled-recovery product built for the OpenAI WebMCP Challenge. MyShop is a separate modern-home storefront connected to the same deterministic causal operations environment.

## Live applications

- Seigyo: https://seigyo.cord-pail.workers.dev
- MyShop: https://myshop.cord-pail.workers.dev
- Operations API: https://seigyo-operations-api.cord-pail.workers.dev
- Rollback API: https://seigyo-api.cord-pail.workers.dev

The active applications run on the claimed Cloudflare account. The rollback API remains deployed and unchanged for release recovery.

## Applications

- `apps/seigyo`: incident operations workspace
- `apps/myshop`: customer storefront
- `services/api`: Cloudflare Worker API and SQLite Durable Object
- `packages/contracts`: shared schemas and public types
- `packages/environment`: deterministic causal state engine

## Environment behavior

- Seven causally connected services with persistent Durable Object state
- Three independently modeled incidents and multiple effective or ineffective interventions
- 30 historical incidents, 60 deployments, 5,040 metric points, and 1,500 log events
- Short-lived approvals bound to the operator, incident state, proposal, and normalized action
- Idempotent execution, stale-state protection, verification, undo, and tamper-evident receipts
- Page-scoped WebMCP tools for both incident operations and customer shopping
- Normal MyShop and Seigyo interfaces that remain fully usable when WebMCP is unavailable

The architecture inventory identifies seven service boundaries across Cloudflare Workers, Render Web Services and Background Workers, Stripe Payments, and Supabase PostgreSQL. The current challenge deployment runs the causal state engine in one Cloudflare Durable Object so the complete environment is deterministic and repeatable.

## Judge flow

1. Open Seigyo first and go to Environment.
2. Click Open storefront and use the linked MyShop tab for all storefront actions. Direct Seigyo and MyShop visits share production health, while every browser keeps a private cart. The linked tab also preserves an explicitly isolated environment when one is being used.
3. If the environment is healthy, return to Seigyo Environment and use Release control to deploy a new revision. In the linked MyShop tab, add the Kuro lounge chair and attempt checkout.
4. Observe the customer-path error while the cart remains intact, then return to the Seigyo tab and select the current active incident from the Active incidents list.
5. Ask the browser agent to investigate the current incident, collect evidence, propose the safest evidence-backed action, wait for approval, execute it, and verify recovery.
6. Approve the exact action in the Agent Console when the human checkpoint appears. The agent continues with execution and verification after approval.
7. Return to the linked MyShop tab and complete the order.

The flow uses the current active incident and does not depend on a fixed incident identifier or a preselected cause. The Seigyo Environment page also provides the operator controls needed to restore the starting condition between judging sessions.

Operating-condition selection and reset are available in Seigyo under Environment.

## Local development

```powershell
pnpm install
pnpm dev
```

The API runs on port 8787, Seigyo on 5173, and MyShop on 5174.

## Verification

```powershell
pnpm verify
pnpm test:e2e
pnpm audit --prod
```

`pnpm verify` uses only validators stored in this repository, so it works after a fresh clone without any private workstation paths. UI research is documented as a text-only source map with links. No third-party screenshots are redistributed in the repository.

## Deployment

Each application deploys independently to Cloudflare Workers. Deploy the operations API first, add its HTTPS URL to `VITE_API_BASE_URL`, add the final frontend origins to the API allowlist, then deploy both frontends. The frontend deployment scripts fail closed when the API URL is missing.

```powershell
pnpm deploy:api
$env:VITE_API_BASE_URL="https://seigyo-operations-api.your-account.workers.dev"
pnpm deploy:seigyo
pnpm deploy:myshop
```

The checkout flow records payment outcomes inside the causal state engine. It does not connect to an external payment processor or collect payment credentials.
