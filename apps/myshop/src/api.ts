import {
  SessionIdSchema,
  type ApiResult,
} from "@seigyo/contracts";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const SESSION_STORAGE_KEY = "myshop.seigyo-session";

const validSession = (value: string | null | undefined): string | undefined => {
  const parsed = SessionIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

const resolveSessionId = (): string => {
  const fromUrl = validSession(new URLSearchParams(location.search).get("session"));
  let stored: string | undefined;
  try {
    stored = validSession(sessionStorage.getItem(SESSION_STORAGE_KEY));
  } catch {
    stored = undefined;
  }
  const resolved = fromUrl ?? stored ?? `judge-${crypto.randomUUID().replaceAll("-", "")}`;
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, resolved);
  } catch {
    // A blocked session store does not prevent the current tab from working.
  }
  return resolved;
};

export const SESSION_ID = resolveSessionId();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", "X-Session-Id": SESSION_ID, ...init?.headers } });
  const result = await response.json() as ApiResult<T>;
  if (!result.ok) { const error = new Error(result.error.message); Object.assign(error, { code: result.error.code }); throw error; }
  return result.data;
}

export const shopApi = {
  products: <T>(query = "", category = "") => request<T>(`/api/store/products?q=${encodeURIComponent(query)}&category=${encodeURIComponent(category)}`),
  product: <T>(slug: string) => request<T>(`/api/store/products/${encodeURIComponent(slug)}`),
  cart: <T>(cartId: string) => request<T>(`/api/store/carts/${encodeURIComponent(cartId)}`),
  updateCart: <T>(cartId: string, productId: string, quantity: number) => request<T>(`/api/store/carts/${encodeURIComponent(cartId)}/items`, { method: "PUT", body: JSON.stringify({ productId, quantity }) }),
  checkout: <T>(input: { cartId: string; email: string; name: string; address: string; requestId: string; idempotencyKey: string }) => request<T>("/api/store/checkout", { method: "POST", body: JSON.stringify(input) }),
  order: <T>(id: string) => request<T>(`/api/store/orders/${encodeURIComponent(id)}`),
  health: <T>() => request<T>("/api/store/health")
};

export const CART_ID = `myshop-${SESSION_ID}`;

export const shopWebsocketUrl = (): string => {
  if (API_BASE)
    return `${API_BASE.replace(/^http/, "ws")}/ws?session=${encodeURIComponent(SESSION_ID)}`;
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws?session=${encodeURIComponent(SESSION_ID)}`;
};
