# Seigyo

Seigyo is an agent-native incident investigation and controlled-recovery product built for the OpenAI WebMCP Challenge. MyShop is a separate modern-home storefront connected to the same causal production simulation.

## Live applications

- Seigyo: https://seigyo.destiny-scooter.workers.dev
- MyShop: https://myshop.destiny-scooter.workers.dev
- Shared API: https://seigyo-api.destiny-scooter.workers.dev

The live deployment uses a temporary Cloudflare preview account until its claim link is completed. The application URLs remain the intended public URLs after the account is claimed.

## Applications

- `apps/seigyo`: incident operations workspace
- `apps/myshop`: customer storefront
- `services/api`: Cloudflare Worker API and SQLite Durable Object
- `packages/contracts`: shared schemas and public types
- `packages/simulation`: deterministic causal state engine

## What makes the demo real

- Seven causally connected services with persistent Durable Object state
- Three independently modeled incidents and multiple effective or ineffective interventions
- 30 historical incidents, 60 deployments, 5,040 metric points, and 1,500 log events
- Short-lived approvals bound to the operator, incident state, proposal, and normalized action
- Idempotent execution, stale-state protection, verification, undo, and tamper-evident receipts
- Page-scoped WebMCP tools for both incident operations and customer shopping
- Normal MyShop and Seigyo interfaces that remain fully usable when WebMCP is unavailable

## Judge flow

1. Open MyShop, add the Kuro lounge chair, and attempt checkout.
2. Observe the safe checkout failure while the cart remains intact.
3. Open incident `INC-042` in Seigyo.
4. Investigate, propose the evidence-backed rollback, and approve the exact action.
5. Execute and verify recovery.
6. Return to MyShop checkout and complete the simulated order.

Scenario selection and reset are available in Seigyo under Environment.

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

## Deployment

Each application deploys independently to Cloudflare Workers. Configure `VITE_API_BASE_URL` for both frontend builds, then run the three deploy scripts from the root package.

This environment is a production simulation. Checkout never charges real money.
