import { Hono } from "hono";
import {
  CartItemInputSchema,
  CheckoutInputSchema,
  DeployCheckoutRevisionInputSchema,
  ExecutionInputSchema,
  ProposalInputSchema,
  PublicKeySchema,
  ResetInputSchema,
  DEFAULT_SESSION_ID,
  SessionIdSchema,
  ServiceIdSchema,
  VerifyInputSchema,
  type ApiResult,
  type ErrorCode,
} from "@seigyo/contracts";
import { createTraceId } from "@seigyo/environment";
export { OperationsStateObject } from "./state";

type AppEnv = { Bindings: Env };
const app = new Hono<AppEnv>();

const allowedOrigins = (env: Env): string[] =>
  env.ALLOWED_ORIGINS.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
app.use("*", async (context, next) => {
  const origin = context.req.header("Origin");
  const allowed = !origin || allowedOrigins(context.env).includes(origin);
  if (!allowed)
    return context.json(
      {
        ok: false,
        error: {
          code: "AUTH_REQUIRED",
          message: "Origin is not allowed.",
          retryable: false,
        },
        stateVersion: 0,
        traceId: createTraceId(),
      },
      403,
    );
  if (context.req.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin ?? "",
        "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,X-Session-Id",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
    });
  await next();
  if (origin && allowed) {
    context.header("Access-Control-Allow-Origin", origin);
    context.header("Vary", "Origin");
  }
  context.header("X-Content-Type-Options", "nosniff");
  context.header("Referrer-Policy", "strict-origin-when-cross-origin");
});

const stub = (env: Env, session: string) =>
  env.OPERATIONS_STATE.getByName(
    session === DEFAULT_SESSION_ID ? "seigyo-production" : `seigyo-${session}`,
  );
const sessionId = (header?: string): string => {
  const parsed = SessionIdSchema.safeParse(header);
  if (!parsed.success)
    throw new Error(
      "AUTH_REQUIRED:An operator session is required. Open Seigyo to create one.",
    );
  return parsed.data;
};
const readSessionId = (header?: string): string =>
  header === undefined ? DEFAULT_SESSION_ID : sessionId(header);
const requestStub = (env: Env, header?: string) =>
  stub(env, readSessionId(header));
const boundedLimit = (
  raw: string | undefined,
  fallback: number,
  maximum: number,
): number => {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw))
    throw new Error(
      `INVALID_ARGUMENT:limit must be an integer from 1 to ${maximum}.`,
    );
  const value = Number(raw);
  if (value < 1 || value > maximum)
    throw new Error(
      `INVALID_ARGUMENT:limit must be an integer from 1 to ${maximum}.`,
    );
  return value;
};
const boundedQuery = (raw: string | undefined): string => {
  const value = raw ?? "";
  if (value.length > 100)
    throw new Error(
      "INVALID_ARGUMENT:query must contain at most 100 characters.",
    );
  return value;
};
const publicRouteKey = (value: string, field: string): string => {
  const parsed = PublicKeySchema.safeParse(value);
  if (
    !parsed.success ||
    ["__proto__", "prototype", "constructor"].includes(parsed.data)
  )
    throw new Error(`INVALID_ARGUMENT:${field} is invalid.`);
  return parsed.data;
};
const success = <T>(data: T, stateVersion = 0): ApiResult<T> => ({
  ok: true,
  data,
  stateVersion,
  traceId: createTraceId(),
});
const errorCode = (message: string): ErrorCode =>
  message.includes("IDEMPOTENCY_CONFLICT")
    ? "CONFLICT"
    : message.includes("INVALID_ACTION")
      ? "INVALID_ARGUMENT"
      : message.includes("NOT_FOUND")
        ? "NOT_FOUND"
        : message.includes("AUTH_REQUIRED")
          ? "AUTH_REQUIRED"
          : message.includes("APPROVAL_REQUIRED")
            ? "APPROVAL_REQUIRED"
            : message.includes("STALE_STATE")
              ? "STALE_STATE"
              : message.includes("PRECONDITION_FAILED")
                ? "PRECONDITION_FAILED"
                : message.includes("IRREVERSIBLE")
                  ? "IRREVERSIBLE"
                  : message.includes("UPSTREAM_UNAVAILABLE")
                    ? "UPSTREAM_UNAVAILABLE"
                    : "INVALID_ARGUMENT";
const failure = (caught: unknown, stateVersion = 0): ApiResult<never> => {
  const message =
    caught instanceof Error ? caught.message : "Unexpected request failure";
  const code = errorCode(message);
  return {
    ok: false,
    error: {
      code,
      message: message.includes(":")
        ? message.slice(message.indexOf(":") + 1)
        : message.replaceAll("_", " ").toLowerCase(),
      retryable: code === "UPSTREAM_UNAVAILABLE" || code === "RATE_LIMITED",
      requiresHuman: code === "APPROVAL_REQUIRED",
    },
    stateVersion,
    traceId: createTraceId(),
  };
};
const json = async (context: {
  req: { header(name: string): string | undefined; raw: Request };
}): Promise<unknown> => {
  const declaredLength = Number(context.req.header("Content-Length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > 65_536)
    throw new Error("INVALID_ARGUMENT:Request body is too large.");
  const reader = context.req.raw.body?.getReader();
  if (!reader)
    throw new Error("INVALID_ARGUMENT:A JSON request body is required.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 65_536) {
      await reader.cancel();
      throw new Error("INVALID_ARGUMENT:Request body is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
};

app.get("/", (context) =>
  context.json({
    name: "Seigyo API",
    environment: context.env.ENVIRONMENT,
    status: "ok",
  }),
);
app.get("/api/snapshot", async (context) => {
  const data = await requestStub(context.env, context.req.header("X-Session-Id")).getSnapshot();
  return context.json(success(data, data.causalRevision));
});
app.get("/api/incidents", async (context) =>
  context.json(success(await requestStub(context.env, context.req.header("X-Session-Id")).listIncidents())),
);
app.get("/api/incidents/:id", async (context) => {
  const data = await requestStub(context.env, context.req.header("X-Session-Id")).getIncident(context.req.param("id"));
  return data.incident
    ? context.json(success(data))
    : context.json(failure(new Error("NOT_FOUND")), 404);
});
app.get("/api/services", async (context) =>
  context.json(success(await requestStub(context.env, context.req.header("X-Session-Id")).listServices())),
);
app.get("/api/deployments", async (context) => {
  const raw = context.req.query("serviceId");
  const serviceId = raw ? ServiceIdSchema.parse(raw) : undefined;
  return context.json(
    success(await requestStub(context.env, context.req.header("X-Session-Id")).listDeployments(serviceId)),
  );
});
app.post("/api/deployments/checkout/revisions", async (context) => {
  try {
    sessionId(context.req.header("X-Session-Id"));
    const input = DeployCheckoutRevisionInputSchema.parse(await json(context));
    const data = await requestStub(context.env, context.req.header("X-Session-Id")).deployCheckoutRevision(input);
    return context.json(success(data, data.causalRevision), 201);
  } catch (caught) {
    const code = errorCode(caught instanceof Error ? caught.message : "");
    return context.json(
      failure(caught),
      code === "AUTH_REQUIRED"
        ? 401
        : code === "CONFLICT" || code === "PRECONDITION_FAILED"
          ? 409
          : 400,
    );
  }
});
app.get("/api/dependencies", async (context) => {
  const raw = context.req.query("serviceId");
  const serviceId = raw ? ServiceIdSchema.parse(raw) : undefined;
  return context.json(
    success(await requestStub(context.env, context.req.header("X-Session-Id")).listDependencies(serviceId)),
  );
});
app.get("/api/metrics", async (context) => {
  const raw = context.req.query("serviceId");
  const serviceId = raw ? ServiceIdSchema.parse(raw) : undefined;
  return context.json(
    success(
      await requestStub(context.env, context.req.header("X-Session-Id")).getMetrics(
        serviceId,
        boundedLimit(context.req.query("limit"), 180, 300),
      ),
    ),
  );
});
app.get("/api/logs", async (context) => {
  const raw = context.req.query("serviceId");
  const serviceId = raw ? ServiceIdSchema.parse(raw) : undefined;
  return context.json(
    success(
      await requestStub(context.env, context.req.header("X-Session-Id")).getLogs(
        serviceId,
        boundedQuery(context.req.query("query")),
        boundedLimit(context.req.query("limit"), 50, 50),
      ),
    ),
  );
});
app.get("/api/runbooks", async (context) =>
  context.json(success(await requestStub(context.env, context.req.header("X-Session-Id")).getRunbooks())),
);
app.get("/api/receipts", async (context) =>
  context.json(success(await requestStub(context.env, context.req.header("X-Session-Id")).getReceipts())),
);
app.get("/api/agent-activity", async (context) =>
  context.json(success(await requestStub(context.env, context.req.header("X-Session-Id")).getAgentActivity())),
);

app.post("/api/investigate", async (context) => {
  try {
    sessionId(context.req.header("X-Session-Id"));
    const body = (await json(context)) as { incidentId?: string };
    if (!body.incidentId)
      throw new Error("INVALID_ARGUMENT:incidentId is required.");
    const data = await requestStub(context.env, context.req.header("X-Session-Id")).investigateIncident(body.incidentId);
    return data
      ? context.json(success(data))
      : context.json(failure(new Error("NOT_FOUND")), 404);
  } catch (caught) {
    return context.json(
      failure(caught),
      errorCode(caught instanceof Error ? caught.message : "") ===
        "AUTH_REQUIRED"
        ? 401
        : 400,
    );
  }
});
app.post("/api/proposals", async (context) => {
  try {
    sessionId(context.req.header("X-Session-Id"));
    const input = ProposalInputSchema.parse(await json(context));
    const data = await requestStub(context.env, context.req.header("X-Session-Id")).createProposal(input);
    return context.json(success(data, data.causalRevision), 201);
  } catch (caught) {
    const code = errorCode(caught instanceof Error ? caught.message : "");
    return context.json(
      failure(caught),
      code === "AUTH_REQUIRED" ? 401 : code === "CONFLICT" ? 409 : 400,
    );
  }
});
app.post("/api/proposals/:id/approve", async (context) => {
  try {
    const data = await requestStub(context.env, context.req.header("X-Session-Id")).approve(
      context.req.param("id"),
      sessionId(context.req.header("X-Session-Id")),
    );
    return context.json(success(data));
  } catch (caught) {
    return context.json(
      failure(caught),
      errorCode(caught instanceof Error ? caught.message : "") ===
        "AUTH_REQUIRED"
        ? 401
        : 409,
    );
  }
});
app.post("/api/proposals/:id/reject", async (context) => {
  try {
    sessionId(context.req.header("X-Session-Id"));
    return context.json(
      success(await requestStub(context.env, context.req.header("X-Session-Id")).reject(context.req.param("id"))),
    );
  } catch (caught) {
    return context.json(
      failure(caught),
      errorCode(caught instanceof Error ? caught.message : "") ===
        "AUTH_REQUIRED"
        ? 401
        : 409,
    );
  }
});
app.post("/api/executions", async (context) => {
  try {
    const input = ExecutionInputSchema.parse(await json(context));
    const data = await requestStub(context.env, context.req.header("X-Session-Id")).execute(
      input.proposalId,
      input.approvalToken,
      input.idempotencyKey,
      sessionId(context.req.header("X-Session-Id")),
    );
    return context.json(success(data), 202);
  } catch (caught) {
    return context.json(failure(caught), 409);
  }
});
app.post("/api/verifications", async (context) => {
  try {
    sessionId(context.req.header("X-Session-Id"));
    const input = VerifyInputSchema.parse(await json(context));
    const data = await requestStub(context.env, context.req.header("X-Session-Id")).verify(
      input.executionId,
      input.incidentId,
    );
    return context.json(success(data));
  } catch (caught) {
    return context.json(
      failure(caught),
      errorCode(caught instanceof Error ? caught.message : "") ===
        "AUTH_REQUIRED"
        ? 401
        : 400,
    );
  }
});
app.post("/api/undo", async (context) => {
  try {
    sessionId(context.req.header("X-Session-Id"));
    const body = (await json(context)) as {
      executionId?: string;
      idempotencyKey?: string;
    };
    if (!body.executionId || !body.idempotencyKey)
      throw new Error(
        "INVALID_ARGUMENT:executionId and idempotencyKey are required.",
      );
    return context.json(
      success(
        await requestStub(context.env, context.req.header("X-Session-Id")).undo(body.executionId, body.idempotencyKey),
      ),
    );
  } catch (caught) {
    return context.json(
      failure(caught),
      errorCode(caught instanceof Error ? caught.message : "") ===
        "AUTH_REQUIRED"
        ? 401
        : 409,
    );
  }
});
app.post("/api/scenario/reset", async (context) => {
  try {
    sessionId(context.req.header("X-Session-Id"));
    const input = ResetInputSchema.parse(await json(context));
    const data = await requestStub(context.env, context.req.header("X-Session-Id")).reset(input.scenario);
    return context.json(success(data, data.causalRevision));
  } catch (caught) {
    return context.json(
      failure(caught),
      errorCode(caught instanceof Error ? caught.message : "") ===
        "AUTH_REQUIRED"
        ? 401
        : 400,
    );
  }
});

app.get("/api/store/products", async (context) =>
  context.json(
    success(
      await requestStub(context.env, context.req.header("X-Session-Id")).getProducts(
        context.req.query("q") ?? "",
        context.req.query("category") ?? "",
      ),
    ),
  ),
);
app.get("/api/store/products/:slug", async (context) => {
  const product = await requestStub(context.env, context.req.header("X-Session-Id")).getProduct(publicRouteKey(context.req.param("slug"), "slug"));
  return product
    ? context.json(success(product))
    : context.json(failure(new Error("NOT_FOUND")), 404);
});
app.get("/api/store/carts/:id", async (context) =>
  context.json(
    success(await requestStub(context.env, context.req.header("X-Session-Id")).getCart(publicRouteKey(context.req.param("id"), "cartId"))),
  ),
);
app.put("/api/store/carts/:id/items", async (context) => {
  try {
    sessionId(context.req.header("X-Session-Id"));
    const input = CartItemInputSchema.parse(await json(context));
    return context.json(
      success(
        await requestStub(context.env, context.req.header("X-Session-Id")).setCartItem(
          publicRouteKey(context.req.param("id"), "cartId"),
          input.productId,
          input.quantity,
        ),
      ),
    );
  } catch (caught) {
    const code = errorCode(caught instanceof Error ? caught.message : "");
    return context.json(failure(caught), code === "AUTH_REQUIRED" ? 401 : 400);
  }
});
app.post("/api/store/checkout", async (context) => {
  try {
    sessionId(context.req.header("X-Session-Id"));
    const input = CheckoutInputSchema.parse(await json(context));
    return context.json(
      success(await requestStub(context.env, context.req.header("X-Session-Id")).createOrder(input)),
      201,
    );
  } catch (caught) {
    return context.json(
      failure(caught),
      errorCode(caught instanceof Error ? caught.message : "") ===
        "AUTH_REQUIRED"
        ? 401
        : errorCode(caught instanceof Error ? caught.message : "") ===
            "UPSTREAM_UNAVAILABLE"
          ? 503
          : 400,
    );
  }
});
app.get("/api/store/orders/:id", async (context) => {
  const order = await requestStub(context.env, context.req.header("X-Session-Id")).getOrder(publicRouteKey(context.req.param("id"), "orderId"));
  return order
    ? context.json(success(order))
    : context.json(failure(new Error("NOT_FOUND")), 404);
});
app.get("/api/store/health", async (context) =>
  context.json(success(await requestStub(context.env, context.req.header("X-Session-Id")).getStoreHealth())),
);

app.get("/ws", async (context) => {
  const origin = context.req.header("Origin");
  const requestedSession = SessionIdSchema.safeParse(
    context.req.query("session"),
  );
  if (!origin || !allowedOrigins(context.env).includes(origin) || !requestedSession.success)
    return new Response("Forbidden", { status: 403 });
  return stub(context.env, requestedSession.data).fetch(context.req.raw);
});

app.onError((caught, context) => {
  console.error(
    JSON.stringify({
      event: "request.error",
      message: caught.message,
      path: context.req.path,
    }),
  );
  const code = errorCode(caught.message);
  const status =
    caught.name === "ZodError" || code === "INVALID_ARGUMENT"
      ? 400
      : code === "AUTH_REQUIRED"
        ? 403
        : code === "NOT_FOUND"
          ? 404
          : 500;
  return context.json(failure(caught), status);
});

export default app;
